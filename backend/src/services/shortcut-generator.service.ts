import crypto from 'crypto';

/**
 * Generates Apple Shortcuts .shortcut plist files for myDrive photo/video upload.
 *
 * VIDEO FIX STRATEGY: Instead of conditionals (which are unreliable in plist generation),
 * we use SEPARATE LOOPS for photos and videos:
 *
 *   - Photos: uploaded DIRECTLY via multipart form (Repeat Item → formFieldFile).
 *     This works because PHAsset CAN produce file representations for images.
 *
 *   - Videos: Encode Media action first (materializes PHAsset video via AVAssetExportSession),
 *     then upload the encoded output via formFieldFileFromOutput.
 *     This bypasses the broken retrieveFileWithImageManager path that causes
 *     "WFPhotoMediaContentItem produced no file representation for type public.mpeg-4".
 *
 *   - Auto Sync: Two Find Photos queries (filtered by Media Type = Photo / Video).
 *   - Upload: Choose from Menu → Photos or Videos → dedicated select + upload path.
 */
export class ShortcutGeneratorService {
  private static uuid(): string {
    return crypto.randomUUID().toUpperCase();
  }

  private static esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ─── Plist building blocks ───────────────────────────────────

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

  private static varRef(outputUUID: string, outputName: string): string {
    return `<dict>
              <key>Value</key>
              <dict>
                <key>attachmentsByRange</key>
                <dict>
                  <key>{0, 1}</key>
                  <dict>
                    <key>OutputName</key>
                    <string>${this.esc(outputName)}</string>
                    <key>OutputUUID</key>
                    <string>${outputUUID}</string>
                    <key>Type</key>
                    <string>ActionOutput</string>
                  </dict>
                </dict>
                <key>string</key>
                <string>\uFFFC</string>
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

  private static formFieldText(key: string, uuid: string, name: string): string {
    return `<dict>
              <key>WFItemType</key>
              <integer>0</integer>
              <key>WFKey</key>
              ${this.text(key)}
              <key>WFValue</key>
              ${this.varRef(uuid, name)}
            </dict>`;
  }

  private static formFieldStaticText(key: string, value: string): string {
    return `<dict>
              <key>WFItemType</key>
              <integer>0</integer>
              <key>WFKey</key>
              ${this.text(key)}
              <key>WFValue</key>
              ${this.text(value)}
            </dict>`;
  }

  /** File attachment referencing a magic variable (e.g. "Repeat Item") */
  private static formFieldFile(key: string, variableName: string): string {
    return `<dict>
              <key>WFItemType</key>
              <integer>5</integer>
              <key>WFKey</key>
              ${this.text(key)}
              <key>WFValue</key>
              <dict>
                <key>Value</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>Type</key>
                    <string>Variable</string>
                    <key>VariableName</key>
                    <string>${this.esc(variableName)}</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenAttachment</string>
                </dict>
                <key>WFSerializationType</key>
                <string>WFTokenAttachmentParameterState</string>
              </dict>
            </dict>`;
  }

  /** File attachment referencing an action output (e.g. Encode Media output) */
  private static formFieldFileFromOutput(key: string, uuid: string, name: string): string {
    return `<dict>
              <key>WFItemType</key>
              <integer>5</integer>
              <key>WFKey</key>
              ${this.text(key)}
              <key>WFValue</key>
              <dict>
                <key>Value</key>
                <dict>
                  <key>Value</key>
                  <dict>
                    <key>OutputName</key>
                    <string>${this.esc(name)}</string>
                    <key>OutputUUID</key>
                    <string>${uuid}</string>
                    <key>Type</key>
                    <string>ActionOutput</string>
                  </dict>
                  <key>WFSerializationType</key>
                  <string>WFTextTokenAttachment</string>
                </dict>
                <key>WFSerializationType</key>
                <string>WFTokenAttachmentParameterState</string>
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

  // ─── Photo loop body (direct upload, NO encoding) ────────────

  private static photoLoopBody(serverUrl: string, deviceId: string, deviceKey: string): string {
    const nameUUID = this.uuid();
    const uploadUUID = this.uuid();

    return `
    <!-- Get filename -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.getitemname</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${nameUUID}</string>
        <key>CustomOutputName</key>
        <string>FileName</string>
        <key>WFInput</key>
        ${this.varInput('Repeat Item')}
      </dict>
    </dict>

    <!-- Upload photo directly (Repeat Item → multipart file) -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${uploadUUID}</string>
        <key>CustomOutputName</key>
        <string>UploadResult</string>
        <key>WFURL</key>
        <string>${this.esc(serverUrl)}/api/v1/shortcuts/upload?deviceId=${this.esc(deviceId)}&amp;deviceKey=${this.esc(deviceKey)}</string>
        <key>WFHTTPMethod</key>
        <string>POST</string>
        <key>WFHTTPHeaders</key>
        ${this.headersDict([
          this.headerItem('X-Device-Id', deviceId),
          this.headerItem('X-Device-Key', deviceKey),
        ])}
        <key>WFHTTPBodyType</key>
        <string>Form</string>
        <key>WFFormValues</key>
        ${this.headersDict([
          this.formFieldFile('media', 'Repeat Item'),
          this.formFieldText('filename', nameUUID, 'FileName'),
          this.formFieldText('deviceAssetId', nameUUID, 'FileName'),
          this.formFieldStaticText('deviceId', deviceId),
          this.formFieldStaticText('deviceKey', deviceKey),
        ])}
      </dict>
    </dict>`;
  }

  // ─── Video loop body (Encode Media THEN upload) ──────────────

  private static videoLoopBody(serverUrl: string, deviceId: string, deviceKey: string): string {
    const encodeUUID = this.uuid();
    const nameUUID = this.uuid();
    const uploadUUID = this.uuid();

    return `
    <!-- Encode Media: materializes video PHAsset to a real file on disk.
         Uses AVAssetExportSession internally (requestAVAsset path) which
         CAN extract video data from PHAsset, unlike the normal file
         representation path that fails with public.mpeg-4 error. -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.encodemedia</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${encodeUUID}</string>
        <key>CustomOutputName</key>
        <string>EncodedVideo</string>
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
        <string>FileName</string>
        <key>WFInput</key>
        ${this.actionInput(encodeUUID, 'EncodedVideo')}
      </dict>
    </dict>

    <!-- Upload encoded video -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${uploadUUID}</string>
        <key>CustomOutputName</key>
        <string>UploadResult</string>
        <key>WFURL</key>
        <string>${this.esc(serverUrl)}/api/v1/shortcuts/upload?deviceId=${this.esc(deviceId)}&amp;deviceKey=${this.esc(deviceKey)}</string>
        <key>WFHTTPMethod</key>
        <string>POST</string>
        <key>WFHTTPHeaders</key>
        ${this.headersDict([
          this.headerItem('X-Device-Id', deviceId),
          this.headerItem('X-Device-Key', deviceKey),
        ])}
        <key>WFHTTPBodyType</key>
        <string>Form</string>
        <key>WFFormValues</key>
        ${this.headersDict([
          this.formFieldFileFromOutput('media', encodeUUID, 'EncodedVideo'),
          this.formFieldText('filename', nameUUID, 'FileName'),
          this.formFieldText('deviceAssetId', nameUUID, 'FileName'),
          this.formFieldStaticText('deviceId', deviceId),
          this.formFieldStaticText('deviceKey', deviceKey),
        ])}
      </dict>
    </dict>`;
  }

  // ─── Media type filter predicate for Find Photos ─────────────

  private static mediaTypeFilter(mediaType: 'Photo' | 'Video'): string {
    return `
        <key>WFContentItemFilter</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFActionParameterFilterPrefix</key>
            <integer>1</integer>
            <key>WFActionParameterFilterTemplates</key>
            <array>
              <dict>
                <key>Operator</key>
                <integer>4</integer>
                <key>Property</key>
                <string>Media Type</string>
                <key>Removable</key>
                <true/>
                <key>Values</key>
                <dict>
                  <key>Unit</key>
                  <integer>4</integer>
                  <key>Value</key>
                  <dict>
                    <key>attachmentsByRange</key>
                    <dict/>
                    <key>string</key>
                    <string>${mediaType}</string>
                  </dict>
                </dict>
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFContentPredicateTableTemplate</string>
        </dict>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  AUTO-SYNC SHORTCUT
  //  Two separate phases: Photos (direct) + Videos (Encode Media)
  // ═══════════════════════════════════════════════════════════════

  static generateAutoSyncShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const findPhotosUUID = this.uuid();
    const findVideosUUID = this.uuid();
    const photoLoopGroup = this.uuid();
    const videoLoopGroup = this.uuid();

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- ═══ PHASE 1: PHOTOS (direct upload, no encoding needed) ═══ -->

    <!-- Find 25 Latest Photos (Images only) -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.filter.photos</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${findPhotosUUID}</string>
        <key>CustomOutputName</key>
        <string>RecentPhotos</string>
        <key>WFContentItemLimitEnabled</key>
        <true/>
        <key>WFContentItemLimit</key>
        <integer>25</integer>
        <key>WFContentItemSortProperty</key>
        <string>Date Taken</string>
        <key>WFContentItemSortOrder</key>
        <string>Latest First</string>
        ${this.mediaTypeFilter('Photo')}
      </dict>
    </dict>

    <!-- Repeat with Each Photo -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${photoLoopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFInput</key>
        ${this.actionInput(findPhotosUUID, 'RecentPhotos')}
      </dict>
    </dict>

    ${this.photoLoopBody(serverUrl, deviceId, deviceKey)}

    <!-- End Photo Repeat -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${photoLoopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>2</integer>
      </dict>
    </dict>

    <!-- ═══ PHASE 2: VIDEOS (Encode Media first, then upload) ═══ -->

    <!-- Find 25 Latest Videos -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.filter.photos</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${findVideosUUID}</string>
        <key>CustomOutputName</key>
        <string>RecentVideos</string>
        <key>WFContentItemLimitEnabled</key>
        <true/>
        <key>WFContentItemLimit</key>
        <integer>25</integer>
        <key>WFContentItemSortProperty</key>
        <string>Date Taken</string>
        <key>WFContentItemSortOrder</key>
        <string>Latest First</string>
        ${this.mediaTypeFilter('Video')}
      </dict>
    </dict>

    <!-- Repeat with Each Video -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${videoLoopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFInput</key>
        ${this.actionInput(findVideosUUID, 'RecentVideos')}
      </dict>
    </dict>

    ${this.videoLoopBody(serverUrl, deviceId, deviceKey)}

    <!-- End Video Repeat -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${videoLoopGroup}</string>
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

  // ═══════════════════════════════════════════════════════════════
  //  MANUAL UPLOAD SHORTCUT
  //  Choose from Menu: Photos or Videos → dedicated path each
  // ═══════════════════════════════════════════════════════════════

  static generateUploadShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const menuGroupId = this.uuid();
    const selectPhotosUUID = this.uuid();
    const selectVideosUUID = this.uuid();
    const photoLoopGroup = this.uuid();
    const videoLoopGroup = this.uuid();

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- Choose from Menu: Photos or Videos -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.choosefrommenu</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${menuGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFMenuItems</key>
        <array>
          <string>📷 Upload Photos</string>
          <string>🎬 Upload Videos</string>
        </array>
        <key>WFMenuPrompt</key>
        <string>What would you like to upload?</string>
      </dict>
    </dict>

    <!-- ═══ MENU ITEM 1: PHOTOS ═══ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.choosefrommenu</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${menuGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>1</integer>
        <key>WFMenuItemTitle</key>
        <string>📷 Upload Photos</string>
      </dict>
    </dict>

    <!-- Select Photos (Images + Live Photos only) -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.selectphoto</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${selectPhotosUUID}</string>
        <key>CustomOutputName</key>
        <string>SelectedPhotos</string>
        <key>WFSelectMultiplePhotos</key>
        <true/>
        <key>WFPhotoPickerTypes</key>
        <array>
          <string>Images</string>
          <string>Live Photos</string>
        </array>
      </dict>
    </dict>

    <!-- Repeat with Each Photo -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${photoLoopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFInput</key>
        ${this.actionInput(selectPhotosUUID, 'SelectedPhotos')}
      </dict>
    </dict>

    ${this.photoLoopBody(serverUrl, deviceId, deviceKey)}

    <!-- End Photo Repeat -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${photoLoopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>2</integer>
      </dict>
    </dict>

    <!-- ═══ MENU ITEM 2: VIDEOS ═══ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.choosefrommenu</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${menuGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>1</integer>
        <key>WFMenuItemTitle</key>
        <string>🎬 Upload Videos</string>
      </dict>
    </dict>

    <!-- Select Videos only -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.selectphoto</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${selectVideosUUID}</string>
        <key>CustomOutputName</key>
        <string>SelectedVideos</string>
        <key>WFSelectMultiplePhotos</key>
        <true/>
        <key>WFPhotoPickerTypes</key>
        <array>
          <string>Videos</string>
        </array>
      </dict>
    </dict>

    <!-- Repeat with Each Video -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${videoLoopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFInput</key>
        ${this.actionInput(selectVideosUUID, 'SelectedVideos')}
      </dict>
    </dict>

    ${this.videoLoopBody(serverUrl, deviceId, deviceKey)}

    <!-- End Video Repeat -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${videoLoopGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>2</integer>
      </dict>
    </dict>

    <!-- End Menu -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.choosefrommenu</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${menuGroupId}</string>
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
