import crypto from 'crypto';

/**
 * Generates Apple Shortcuts for myDrive photo/video upload.
 *
 * STRATEGY (v7 — raw binary upload):
 * 1. Encode Media for ALL items (photos AND videos) — materializes PHAsset
 *    into a real file via AVAssetExportSession (videos) or image encoder (photos).
 * 2. Get Name of encoded output → filename for the upload.
 * 3. Upload via raw binary body (WFHTTPBodyType: "File") — NOT multipart form.
 *    This completely bypasses the WFPhotoMediaContentItem file-representation
 *    code path that causes the public.mpeg-4 / com.apple.quicktime-movie error.
 * 4. Metadata (filename, deviceId, deviceKey) sent as query parameters + headers.
 *
 * NO conditionals, NO SetVariable, NO multipart form fields.
 */
export class ShortcutGeneratorService {
  private static uuid(): string {
    return crypto.randomUUID().toUpperCase();
  }

  private static esc(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  private static text(value: string): string {
    return `<dict>
              <key>Value</key>
              <dict>
                <key>attachmentsByRange</key>
                <dict/>
                <key>string</key>
                <string>${this.esc(value)}</string>
              </dict>
              <key>WFSerializationType</key>
              <string>WFTextTokenString</string>
            </dict>`;
  }

  private static actionInput(outputUUID: string, outputName: string): string {
    return `<dict>
              <key>Value</key>
              <dict>
                <key>OutputName</key>
                <string>${this.esc(outputName)}</string>
                <key>OutputUUID</key>
                <string>${outputUUID}</string>
                <key>Type</key>
                <string>ActionOutput</string>
              </dict>
              <key>WFSerializationType</key>
              <string>WFTextTokenAttachment</string>
            </dict>`;
  }

  private static varInput(variableName: string): string {
    return `<dict>
              <key>Value</key>
              <dict>
                <key>Type</key>
                <string>Variable</string>
                <key>VariableName</key>
                <string>${this.esc(variableName)}</string>
              </dict>
              <key>WFSerializationType</key>
              <string>WFTextTokenAttachment</string>
            </dict>`;
  }

  /**
   * Build a URL string with variable tokens embedded.
   * We embed the filename variable into the URL using the FFFC placeholder pattern.
   */
  private static urlWithTokens(
    baseUrl: string,
    nameUUID: string,
    nameOutputName: string,
    deviceId: string,
    deviceKey: string
  ): string {
    // The URL has a token for filename: we use attachmentsByRange to embed the variable
    // Format: baseUrl/api/v1/shortcuts/upload?deviceId=xxx&deviceKey=xxx&filename=￼&deviceAssetId=￼
    // Two tokens: one for filename, one for deviceAssetId, both from the same name action output
    const prefix = `${this.esc(baseUrl)}/api/v1/shortcuts/upload?deviceId=${this.esc(deviceId)}&amp;deviceKey=${this.esc(deviceKey)}&amp;filename=`;
    const middle = `&amp;deviceAssetId=`;
    // ￼ is U+FFFC (Object Replacement Character) - the token placeholder
    // Range for first token: starts at prefix.length (after XML unescaping), length 1
    // Range for second token: starts at prefix.length + 1 + middle.length, length 1
    // But we need to compute on the UNESCAPED string length

    // Simpler approach: build the URL template with two FFFC tokens
    const unescPrefix = `${baseUrl}/api/v1/shortcuts/upload?deviceId=${deviceId}&deviceKey=${deviceKey}&filename=`;
    const unescMiddle = `&deviceAssetId=`;

    const pos1 = unescPrefix.length;
    const pos2 = pos1 + 1 + unescMiddle.length;

    return `<dict>
              <key>Value</key>
              <dict>
                <key>attachmentsByRange</key>
                <dict>
                  <key>{${pos1}, 1}</key>
                  <dict>
                    <key>OutputName</key>
                    <string>${this.esc(nameOutputName)}</string>
                    <key>OutputUUID</key>
                    <string>${nameUUID}</string>
                    <key>Type</key>
                    <string>ActionOutput</string>
                  </dict>
                  <key>{${pos2}, 1}</key>
                  <dict>
                    <key>OutputName</key>
                    <string>${this.esc(nameOutputName)}</string>
                    <key>OutputUUID</key>
                    <string>${nameUUID}</string>
                    <key>Type</key>
                    <string>ActionOutput</string>
                  </dict>
                </dict>
                <key>string</key>
                <string>${prefix}\uFFFC${middle}\uFFFC</string>
              </dict>
              <key>WFSerializationType</key>
              <string>WFTextTokenString</string>
            </dict>`;
  }

  private static headerItem(key: string, value: string): string {
    return `<dict>
              <key>WFItemType</key>
              <integer>0</integer>
              <key>WFKey</key>
              ${this.text(key)}
              <key>WFValue</key>
              ${this.text(value)}
            </dict>`;
  }

  private static headerItemWithToken(key: string, uuid: string, outputName: string): string {
    return `<dict>
              <key>WFItemType</key>
              <integer>0</integer>
              <key>WFKey</key>
              ${this.text(key)}
              <key>WFValue</key>
              <dict>
                <key>Value</key>
                <dict>
                  <key>attachmentsByRange</key>
                  <dict>
                    <key>{0, 1}</key>
                    <dict>
                      <key>OutputName</key>
                      <string>${this.esc(outputName)}</string>
                      <key>OutputUUID</key>
                      <string>${uuid}</string>
                      <key>Type</key>
                      <string>ActionOutput</string>
                    </dict>
                  </dict>
                  <key>string</key>
                  <string>\uFFFC</string>
                </dict>
                <key>WFSerializationType</key>
                <string>WFTextTokenString</string>
              </dict>
            </dict>`;
  }

  private static headersDict(items: string[]): string {
    return `<dict>
              <key>Value</key>
              <dict>
                <key>WFDictionaryFieldValueItems</key>
                <array>
                  ${items.join('\n                  ')}
                </array>
              </dict>
              <key>WFSerializationType</key>
              <string>WFDictionaryFieldValue</string>
            </dict>`;
  }

  /**
   * Loop body: Encode Media → Get Name → Upload as raw binary (File body type).
   *
   * The key change: WFHTTPBodyType is "File" instead of "Form".
   * The encoded media output is sent as the RAW HTTP body.
   * This COMPLETELY avoids the multipart form file-representation code path
   * that triggers the WFPhotoMediaContentItem error for videos.
   *
   * Metadata is sent via query params and headers.
   */
  private static encodeAndUploadBody(serverUrl: string, deviceId: string, deviceKey: string): string {
    const encodeUUID = this.uuid();
    const nameUUID = this.uuid();
    const uploadUUID = this.uuid();

    return `
    <!-- Encode Media: materializes PHAsset into a real file.
         Videos: AVAssetExportSession path (bypasses broken file representation).
         Photos: image encoder path (produces JPEG/PNG file). -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.encodemedia</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${encodeUUID}</string>
        <key>CustomOutputName</key>
        <string>Encoded Media</string>
        <key>WFInput</key>
        ${this.varInput('Repeat Item')}
        <key>WFMediaAudioOnly</key>
        <false/>
      </dict>
    </dict>

    <!-- Get filename from encoded output -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.getitemname</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${nameUUID}</string>
        <key>CustomOutputName</key>
        <string>Media Name</string>
        <key>WFInput</key>
        ${this.actionInput(encodeUUID, 'Encoded Media')}
      </dict>
    </dict>

    <!-- Upload: RAW BINARY body (WFHTTPBodyType: File).
         The encoded media is sent as the entire HTTP body — no multipart form.
         This bypasses WFPhotoMediaContentItem file representation entirely.
         Metadata sent via query params + headers. -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${uploadUUID}</string>
        <key>CustomOutputName</key>
        <string>Upload Result</string>
        <key>WFURL</key>
        ${this.urlWithTokens(serverUrl, nameUUID, 'Media Name', deviceId, deviceKey)}
        <key>WFHTTPMethod</key>
        <string>POST</string>
        <key>WFHTTPHeaders</key>
        ${this.headersDict([
          this.headerItem('X-Device-Id', deviceId),
          this.headerItem('X-Device-Key', deviceKey),
          this.headerItemWithToken('X-Filename', nameUUID, 'Media Name'),
        ])}
        <key>WFHTTPBodyType</key>
        <string>File</string>
        <key>WFRequestVariable</key>
        ${this.actionInput(encodeUUID, 'Encoded Media')}
      </dict>
    </dict>`;
  }

  static generateAutoSyncShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const findUUID = this.uuid();
    const loopGroup = this.uuid();

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- Find 25 Latest Photos & Videos -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.filter.photos</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${findUUID}</string>
        <key>CustomOutputName</key>
        <string>AllMedia</string>
        <key>WFContentItemLimitEnabled</key>
        <true/>
        <key>WFContentItemLimit</key>
        <integer>25</integer>
        <key>WFContentItemSortProperty</key>
        <string>Date Taken</string>
        <key>WFContentItemSortOrder</key>
        <string>Latest First</string>
      </dict>
    </dict>

    <!-- Repeat with Each -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${loopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFInput</key>
        ${this.actionInput(findUUID, 'AllMedia')}
      </dict>
    </dict>

    ${this.encodeAndUploadBody(serverUrl, deviceId, deviceKey)}

    <!-- End Repeat -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${loopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>2</integer>
      </dict>
    </dict>

    <!-- Final notification -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFNotificationActionTitle</key>
        <string>myDrive Auto Sync</string>
        <key>WFNotificationActionBody</key>
        <string>🎉 Media backed up to your personal cloud!</string>
        <key>WFNotificationActionSound</key>
        <true/>
      </dict>
    </dict>

  </array>
  <key>WFWorkflowClientVersion</key>
  <string>2302.0.4</string>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>900</string>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconStartColor</key>
    <integer>2071128575</integer>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59803</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key>
  <array/>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFPhotoMediaContentItem</string>
    <string>WFImageContentItem</string>
    <string>WFGenericFileContentItem</string>
    <string>WFMediaContentItem</string>
    <string>WFAVAssetContentItem</string>
  </array>
  <key>WFWorkflowTypes</key>
  <array>
    <string>NCWidget</string>
    <string>WatchKit</string>
  </array>
  <key>WFWorkflowOutputContentItemClasses</key>
  <array/>
</dict>
</plist>`;
  }

  static generateUploadShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const selectUUID = this.uuid();
    const loopGroup = this.uuid();

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- Select Photos & Videos -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.selectphoto</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${selectUUID}</string>
        <key>CustomOutputName</key>
        <string>SelectedMedia</string>
        <key>WFSelectMultiplePhotos</key>
        <true/>
        <key>WFPhotoPickerTypes</key>
        <array>
          <string>Images</string>
          <string>Videos</string>
          <string>Live Photos</string>
        </array>
      </dict>
    </dict>

    <!-- Repeat with Each -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${loopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFInput</key>
        ${this.actionInput(selectUUID, 'SelectedMedia')}
      </dict>
    </dict>

    ${this.encodeAndUploadBody(serverUrl, deviceId, deviceKey)}

    <!-- End Repeat -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${loopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>2</integer>
      </dict>
    </dict>

    <!-- Final notification -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFNotificationActionTitle</key>
        <string>myDrive Upload Complete</string>
        <key>WFNotificationActionBody</key>
        <string>🎉 All media backed up to your personal cloud!</string>
        <key>WFNotificationActionSound</key>
        <true/>
      </dict>
    </dict>

  </array>
  <key>WFWorkflowClientVersion</key>
  <string>2302.0.4</string>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>900</string>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconStartColor</key>
    <integer>2071128575</integer>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59803</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key>
  <array/>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFPhotoMediaContentItem</string>
    <string>WFImageContentItem</string>
    <string>WFGenericFileContentItem</string>
    <string>WFMediaContentItem</string>
    <string>WFAVAssetContentItem</string>
  </array>
  <key>WFWorkflowTypes</key>
  <array>
    <string>NCWidget</string>
    <string>WatchKit</string>
  </array>
  <key>WFWorkflowOutputContentItemClasses</key>
  <array/>
</dict>
</plist>`;
  }
}
