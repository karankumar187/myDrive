import crypto from 'crypto';

/**
 * Generates fully pre-configured Apple Shortcuts .shortcut plist files.
 *
 * IMPORTANT serialization rules (reverse-engineered from Apple WorkflowKit):
 *
 * 1. Static text: Use `WFTextTokenString` with BOTH `string` AND `attachmentsByRange` (empty dict).
 *    Missing `attachmentsByRange` causes `WFPropertyListParameterValue` crash.
 *
 * 2. Variable references: Embed inside a `WFTextTokenString` using the Object Replacement Character
 *    (\uFFFC) as a placeholder in the `string` field, with the variable descriptor in
 *    `attachmentsByRange` keyed by `{offset, 1}`.
 *
 * 3. Dictionary field values (headers, form fields): Keys and values must be `WFTextTokenString`
 *    with proper `attachmentsByRange`.
 *
 * 4. Action output references need `OutputUUID` matching the producing action's UUID.
 */
export class ShortcutGeneratorService {
  private static uuid(): string {
    return crypto.randomUUID().toUpperCase();
  }

  /** Escapes XML special characters */
  private static esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Static text token — no variable references.
   * Produces a WFTextTokenString with empty attachmentsByRange.
   */
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

  /**
   * Variable reference token — references an action output by UUID.
   * Uses the Object Replacement Character (\uFFFC) as the placeholder.
   */
  private static varRef(outputUUID: string, outputName: string, type: string = 'ActionOutput'): string {
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
                    <string>${type}</string>
                  </dict>
                </dict>
                <key>string</key>
                <string>\uFFFC</string>
              </dict>
              <key>WFSerializationType</key>
              <string>WFTextTokenString</string>
            </dict>`;
  }

  /**
   * Action input attachment — directly attaches an action output as an object input (not a string token).
   * Used for WFInput in actions like repeat.each, count, etc.
   */
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

  /**
   * Variable input attachment — directly attaches a variable (like "Repeat Item") as an object input.
   * Used for WFInput in actions like base64encode, properties.images, etc.
   */
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
   * Magic variable reference — references a built-in variable like "Repeat Item".
   */
  private static magicVar(variableName: string): string {
    return `<dict>
              <key>Value</key>
              <dict>
                <key>attachmentsByRange</key>
                <dict>
                  <key>{0, 1}</key>
                  <dict>
                    <key>Type</key>
                    <string>Variable</string>
                    <key>VariableName</key>
                    <string>${this.esc(variableName)}</string>
                  </dict>
                </dict>
                <key>string</key>
                <string>\uFFFC</string>
              </dict>
              <key>WFSerializationType</key>
              <string>WFTextTokenString</string>
            </dict>`;
  }

  /**
   * Builds a single HTTP header key-value pair for WFHTTPHeaders.
   */
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

  /**
   * Builds a text form field (WFItemType 0) for WFFormValues.
   */
  private static formFieldText(key: string, valueOutputUUID: string, valueOutputName: string): string {
    return `<dict>
              <key>WFItemType</key>
              <integer>0</integer>
              <key>WFKey</key>
              ${this.text(key)}
              <key>WFValue</key>
              ${this.varRef(valueOutputUUID, valueOutputName)}
            </dict>`;
  }

  /**
   * Builds a file form field (WFItemType 0) for WFFormValues — references "Repeat Item".
   * Note: In WorkflowKit, dictionary field values use WFItemType 0 (string/token attachment)
   * which resolves dynamically at runtime to multipart file streaming.
   */
  private static formFieldFile(key: string): string {
    return `<dict>
              <key>WFItemType</key>
              <integer>0</integer>
              <key>WFKey</key>
              ${this.text(key)}
              <key>WFValue</key>
              ${this.magicVar('Repeat Item')}
            </dict>`;
  }

  /**
   * Wraps header items in a WFDictionaryFieldValue serialization container.
   */
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

  // ═══════════════════════════════════════════════════════════════════
  //  AUTO-SYNC SHORTCUT
  // ═══════════════════════════════════════════════════════════════════

  static generateAutoSyncShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const syncCheckUUID = this.uuid();
    const findPhotosUUID = this.uuid();
    const nameUUID = this.uuid();
    const b64UUID = this.uuid();
    const uploadUUID = this.uuid();
    const loopGroupId = this.uuid();

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- ACTION 1: Find 25 Latest Photos Directly from Gallery -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.filter.photos</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${findPhotosUUID}</string>
        <key>CustomOutputName</key>
        <string>NewPhotos</string>
        <key>WFContentItemFilter</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFActionParameterFilterPrefix</key>
            <integer>1</integer>
            <key>WFContentPredicateBoundedDate</key>
            <false/>
            <key>WFActionParameterFilterTemplates</key>
            <array/>
          </dict>
          <key>WFSerializationType</key>
          <string>WFContentPredicateTableTemplate</string>
        </dict>
        <key>WFContentItemSortProperty</key>
        <string>Date Taken</string>
        <key>WFContentItemSortOrder</key>
        <string>Latest First</string>
        <key>WFContentItemLimitEnabled</key>
        <true/>
        <key>WFContentItemLimit</key>
        <integer>25</integer>
      </dict>
    </dict>

    <!-- ACTION 2: Repeat with Each Photo -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFInput</key>
        ${this.actionInput(findPhotosUUID, 'NewPhotos')}
      </dict>
    </dict>

    <!-- LOOP 1: Get Photo Filename -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.properties.images</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${nameUUID}</string>
        <key>CustomOutputName</key>
        <string>FileName</string>
        <key>WFContentItemPropertyName</key>
        <string>Name</string>
        <key>WFInput</key>
        ${this.varInput('Repeat Item')}
      </dict>
    </dict>

    <!-- LOOP 2: Base64 Encode Photo for reliable transfer -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.base64encode</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${b64UUID}</string>
        <key>CustomOutputName</key>
        <string>Base64Photo</string>
        <key>WFEncodeMode</key>
        <string>Encode</string>
        <key>WFBase64LineBreakMode</key>
        <string>None</string>
        <key>WFInput</key>
        ${this.varInput('Repeat Item')}
      </dict>
    </dict>

    <!-- LOOP 3: Upload Photo to myDrive Cloud -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${uploadUUID}</string>
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
        <string>JSON</string>
        <key>WFJSONValues</key>
        ${this.headersDict([
          this.formFieldText('media', b64UUID, 'Base64Photo'),
          this.formFieldText('filename', nameUUID, 'FileName'),
          this.formFieldText('deviceAssetId', nameUUID, 'FileName'),
          this.headerItem('deviceId', deviceId),
          this.headerItem('deviceKey', deviceKey),
        ])}
      </dict>
    </dict>

    <!-- LOOP 4: Notification per uploaded file -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFNotificationActionTitle</key>
        <string>myDrive</string>
        <key>WFNotificationActionBody</key>
        <string>☁️ Photo backed up to cloud</string>
        <key>WFNotificationActionSound</key>
        <false/>
      </dict>
    </dict>

    <!-- End Repeat -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>2</integer>
      </dict>
    </dict>

    <!-- ACTION 10: Final notification -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFNotificationActionTitle</key>
        <string>myDrive Sync Complete</string>
        <key>WFNotificationActionBody</key>
        <string>🎉 Photos backed up to your personal cloud!</string>
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
  <array/>
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

  // ═══════════════════════════════════════════════════════════════════
  //  MANUAL UPLOAD SHORTCUT
  // ═══════════════════════════════════════════════════════════════════

  static generateUploadShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const selectPhotosUUID = this.uuid();
    const countUUID = this.uuid();
    const fileNameUUID = this.uuid();
    const b64UUID = this.uuid();
    const uploadUUID = this.uuid();
    const loopGroupId = this.uuid();

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- Select Photos -->
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
      </dict>
    </dict>


    <!-- Repeat with Each -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFInput</key>
        ${this.actionInput(selectPhotosUUID, 'SelectedPhotos')}
      </dict>
    </dict>

    <!-- LOOP: Get filename -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.properties.images</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${fileNameUUID}</string>
        <key>CustomOutputName</key>
        <string>FileName</string>
        <key>WFContentItemPropertyName</key>
        <string>Name</string>
        <key>WFInput</key>
        ${this.varInput('Repeat Item')}
      </dict>
    </dict>

    <!-- LOOP: Base64 Encode Photo -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.base64encode</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${b64UUID}</string>
        <key>CustomOutputName</key>
        <string>Base64Photo</string>
        <key>WFEncodeMode</key>
        <string>Encode</string>
        <key>WFBase64LineBreakMode</key>
        <string>None</string>
        <key>WFInput</key>
        ${this.varInput('Repeat Item')}
      </dict>
    </dict>

    <!-- LOOP: Upload via JSON -->
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
        <string>JSON</string>
        <key>WFJSONValues</key>
        ${this.headersDict([
          this.formFieldText('media', b64UUID, 'Base64Photo'),
          this.formFieldText('filename', fileNameUUID, 'FileName'),
          this.formFieldText('deviceAssetId', fileNameUUID, 'FileName'),
          this.headerItem('deviceId', deviceId),
          this.headerItem('deviceKey', deviceKey),
        ])}
      </dict>
    </dict>

    <!-- LOOP: Show Alert with Server Response -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.alert</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFAlertActionTitle</key>
        <string>myDrive Upload Result</string>
        <key>WFAlertActionMessage</key>
        ${this.varRef(uploadUUID, 'UploadResult')}
        <key>WFAlertActionCancelButtonShown</key>
        <false/>
      </dict>
    </dict>

    <!-- LOOP: Per-file notification -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFNotificationActionTitle</key>
        <string>myDrive</string>
        <key>WFNotificationActionBody</key>
        <string>✅ Photo uploaded to cloud</string>
        <key>WFNotificationActionSound</key>
        <false/>
      </dict>
    </dict>

    <!-- End Repeat -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
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
        <string>🎉 All photos backed up to your personal cloud!</string>
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
    <integer>1088986111</integer>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59511</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key>
  <array/>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFPhotoMediaContentItem</string>
    <string>WFImageContentItem</string>
    <string>WFGenericFileContentItem</string>
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
