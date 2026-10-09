import crypto from 'crypto';

/**
 * Generates a fully pre-configured Apple Shortcuts plist XML file.
 * When the user taps the downloaded .shortcut file on their iPhone, it imports directly
 * into the Shortcuts app with Device ID, Device Key, and Server URL already embedded.
 * Zero manual setup required.
 */
export class ShortcutGeneratorService {
  private static uuid(): string {
    return crypto.randomUUID().toUpperCase();
  }

  /**
   * Wraps a plain string as a WFTextTokenString serialized value (used in most text fields).
   */
  private static textToken(value: string): string {
    return `<dict>
            <key>Value</key>
            <dict>
              <key>string</key>
              <string>${ShortcutGeneratorService.escape(value)}</string>
            </dict>
            <key>WFSerializationType</key>
            <string>WFTextTokenString</string>
          </dict>`;
  }

  /**
   * Wraps an action output reference (references previous action's output by name).
   */
  private static actionOutputRef(outputName: string): string {
    return `<dict>
            <key>Value</key>
            <dict>
              <key>OutputName</key>
              <string>${ShortcutGeneratorService.escape(outputName)}</string>
              <key>Type</key>
              <string>ActionOutput</string>
            </dict>
            <key>WFSerializationType</key>
            <string>WFTextTokenAttachment</string>
          </dict>`;
  }

  /**
   * References a built-in Shortcuts variable (e.g. "Repeat Item", "Repeat Index").
   */
  private static builtinVarRef(variableName: string): string {
    return `<dict>
            <key>Value</key>
            <dict>
              <key>Type</key>
              <string>Variable</string>
              <key>VariableName</key>
              <string>${ShortcutGeneratorService.escape(variableName)}</string>
            </dict>
            <key>WFSerializationType</key>
            <string>WFTextTokenAttachment</string>
          </dict>`;
  }

  /** Escapes XML special characters in string values */
  private static escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Builds a single HTTP header dictionary item for WFHTTPHeaders.
   */
  private static headerItem(key: string, value: string): string {
    return `<dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                ${ShortcutGeneratorService.textToken(key)}
                <key>WFValue</key>
                ${ShortcutGeneratorService.textToken(value)}
              </dict>`;
  }

  /**
   * Generates the complete XML plist for the myDrive Auto-Sync shortcut.
   * Flow:
   *  1. GET /shortcuts/sync-check → get lastSyncedDate
   *  2. Extract lastSyncedDate from JSON response
   *  3. Find Photos taken after lastSyncedDate (limit 50)
   *  4. Count photos. If 0 → notify "Up to date" and stop.
   *  5. Notify "Starting sync of N photos"
   *  6. Repeat with each photo:
   *     a. Get image filename
   *     b. POST /shortcuts/upload (multipart with credentials in headers)
   *     c. Notify per file
   *  7. Final "Sync complete" notification
   */
  static generateAutoSyncShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const loopGroupId = this.uuid();
    const ifGroupId = this.uuid();

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- ═══════════════════════════════════════════════════ -->
    <!-- ACTION 1: GET sync-check → returns lastSyncedDate  -->
    <!-- ═══════════════════════════════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>CustomOutputName</key>
        <string>SyncStatus</string>
        <key>WFURL</key>
        ${this.textToken(`${serverUrl}/api/v1/shortcuts/sync-check`)}
        <key>WFHTTPMethod</key>
        <string>GET</string>
        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              ${this.headerItem('X-Device-Id', deviceId)}
              ${this.headerItem('X-Device-Key', deviceKey)}
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
        <key>WFHTTPBodyType</key>
        <string>JSON</string>
      </dict>
    </dict>

    <!-- ════════════════════════════════════════════════════ -->
    <!-- ACTION 2: Extract lastSyncedDate from JSON response  -->
    <!-- ════════════════════════════════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.getvalueforkey</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>CustomOutputName</key>
        <string>LastSyncedDateString</string>
        <key>WFDictionaryKey</key>
        <string>lastSyncedDate</string>
        <key>WFInput</key>
        ${this.actionOutputRef('SyncStatus')}
      </dict>
    </dict>

    <!-- ═════════════════════════════════════════════════ -->
    <!-- ACTION 3: Parse ISO date string into a Date value -->
    <!-- ═════════════════════════════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.date</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>CustomOutputName</key>
        <string>LastSyncDate</string>
        <key>WFDateActionMode</key>
        <string>Specified Date</string>
        <key>WFDateActionDate</key>
        ${this.actionOutputRef('LastSyncedDateString')}
      </dict>
    </dict>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- ACTION 4: Find Photos taken AFTER lastSyncDate (max 50) -->
    <!-- ════════════════════════════════════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.filter.photos</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>CustomOutputName</key>
        <string>NewPhotos</string>
        <key>WFContentItemFilter</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFContentPredicateBoundedDate</key>
            <false/>
            <key>WFActionParameterFilterPrefix</key>
            <integer>1</integer>
            <key>WFContentPredicateTableTemplates</key>
            <array>
              <dict>
                <key>WFContentPredicateOperator</key>
                <integer>99</integer>
                <key>WFContentPredicateValue</key>
                ${this.actionOutputRef('LastSyncDate')}
                <key>WFContentPredicateType</key>
                <string>WFPhotoMediaTypeContentItem</string>
                <key>WFContentPredicateProperty</key>
                <string>Photo Date</string>
              </dict>
            </array>
            <key>WFContentPredicateAggregateMatchMode</key>
            <integer>1</integer>
          </dict>
          <key>WFSerializationType</key>
          <string>WFContentPredicateTableTemplate</string>
        </dict>
        <key>WFContentItemLimitEnabled</key>
        <true/>
        <key>WFContentItemLimit</key>
        <integer>50</integer>
        <key>WFContentItemSortProperty</key>
        <string>Photo Date</string>
        <key>WFContentItemSortOrder</key>
        <string>asc</string>
      </dict>
    </dict>

    <!-- ═══════════════════════════ -->
    <!-- ACTION 5: Count new photos  -->
    <!-- ═══════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.count</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>CustomOutputName</key>
        <string>TotalNew</string>
        <key>Input</key>
        ${this.actionOutputRef('NewPhotos')}
      </dict>
    </dict>

    <!-- ═══════════════════════════════════════════════════ -->
    <!-- ACTION 6: IF TotalNew == 0 → already up to date    -->
    <!-- ═══════════════════════════════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.conditional</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${ifGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFCondition</key>
        <integer>4</integer>
        <key>WFNumberValue</key>
        <string>0</string>
        <key>WFInput</key>
        ${this.actionOutputRef('TotalNew')}
      </dict>
    </dict>

    <!-- Show "up to date" notification inside IF block -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${ifGroupId}</string>
        <key>WFNotificationActionTitle</key>
        <string>myDrive Sync</string>
        <key>WFNotificationActionBody</key>
        <string>✅ Already up to date. No new photos.</string>
        <key>WFNotificationActionSound</key>
        <false/>
      </dict>
    </dict>

    <!-- Stop shortcut inside IF block -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.exit</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${ifGroupId}</string>
      </dict>
    </dict>

    <!-- End IF -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.conditional</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${ifGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>2</integer>
      </dict>
    </dict>

    <!-- ═══════════════════════════════════════ -->
    <!-- ACTION 7: Start notification            -->
    <!-- ═══════════════════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>WFNotificationActionTitle</key>
        <string>myDrive Sync</string>
        <key>WFNotificationActionBody</key>
        <string>📸 Starting sync of new photos to your cloud…</string>
        <key>WFNotificationActionSound</key>
        <false/>
      </dict>
    </dict>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- ACTION 8: Set SyncedCount = 0                  -->
    <!-- ═══════════════════════════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.number</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>CustomOutputName</key>
        <string>SyncedCount</string>
        <key>WFNumberActionNumber</key>
        <real>0</real>
      </dict>
    </dict>

    <!-- ═══════════════════════════════════════ -->
    <!-- ACTION 9: Repeat with each new photo    -->
    <!-- ═══════════════════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>Input</key>
        ${this.actionOutputRef('NewPhotos')}
      </dict>
    </dict>

    <!-- ──────────────────────────────── -->
    <!-- LOOP: Get image filename         -->
    <!-- ──────────────────────────────── -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.getitemdetail</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>CustomOutputName</key>
        <string>FileName</string>
        <key>WFItemSpecifier</key>
        <string>Name</string>
        <key>WFInput</key>
        ${this.builtinVarRef('Repeat Item')}
      </dict>
    </dict>

    <!-- ──────────────────────────────────────────── -->
    <!-- LOOP: POST upload to myDrive with device auth -->
    <!-- ──────────────────────────────────────────── -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>CustomOutputName</key>
        <string>UploadResult</string>
        <key>WFURL</key>
        ${this.textToken(`${serverUrl}/api/v1/shortcuts/upload`)}
        <key>WFHTTPMethod</key>
        <string>POST</string>
        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              ${this.headerItem('X-Device-Id', deviceId)}
              ${this.headerItem('X-Device-Key', deviceKey)}
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
        <key>WFHTTPBodyType</key>
        <string>Form</string>
        <key>WFFormValues</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              <dict>
                <key>WFItemType</key>
                <integer>1</integer>
                <key>WFKey</key>
                ${this.textToken('media')}
                <key>WFValue</key>
                ${this.builtinVarRef('Repeat Item')}
              </dict>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                ${this.textToken('filename')}
                <key>WFValue</key>
                ${this.actionOutputRef('FileName')}
              </dict>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                ${this.textToken('deviceAssetId')}
                <key>WFValue</key>
                ${this.actionOutputRef('FileName')}
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
      </dict>
    </dict>

    <!-- ─────────────────────────────────────── -->
    <!-- LOOP: Increment SyncedCount             -->
    <!-- ─────────────────────────────────────── -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.math</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>CustomOutputName</key>
        <string>SyncedCount</string>
        <key>WFMathOperand</key>
        <string>+</string>
        <key>WFInput</key>
        ${this.actionOutputRef('SyncedCount')}
        <key>WFMathOperation</key>
        <string>+</string>
        <key>WFMathOperandValue</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>string</key>
            <string>1</string>
          </dict>
          <key>WFSerializationType</key>
          <string>WFTextTokenString</string>
        </dict>
      </dict>
    </dict>

    <!-- ─────────────────────────────────────── -->
    <!-- LOOP: Notify per file uploaded          -->
    <!-- ─────────────────────────────────────── -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFNotificationActionTitle</key>
        <string>myDrive</string>
        <key>WFNotificationActionBody</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>string</key>
            <string>☁️ Backed up photo to cloud</string>
            <key>attachmentsByRange</key>
            <dict/>
          </dict>
          <key>WFSerializationType</key>
          <string>WFTextTokenString</string>
        </dict>
        <key>WFNotificationActionSound</key>
        <false/>
      </dict>
    </dict>

    <!-- End Repeat loop -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>1</integer>
      </dict>
    </dict>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- ACTION 10: Final "Sync Complete" notification   -->
    <!-- ═══════════════════════════════════════════════ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
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
  <string>1300.0.0.0</string>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>900</string>
  <key>WFWorkflowName</key>
  <string>myDrive Auto Sync</string>
  <key>WFWorkflowHasShortcutInputVariables</key>
  <false/>
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
  <array/>
  <key>WFWorkflowOutputContentItemClasses</key>
  <array/>
</dict>
</plist>`;
  }

  /**
   * Generates the Manual Upload shortcut.
   * Shows a photo picker, uploads selected photos one by one with progress notifications.
   */
  static generateUploadShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
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
      <string>is.workflow.actions.selectphotos</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>CustomOutputName</key>
        <string>SelectedPhotos</string>
        <key>WFSelectMultiplePhotos</key>
        <true/>
        <key>WFSelectPhotosActionType</key>
        <string>Both</string>
      </dict>
    </dict>

    <!-- Count selected -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.count</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>CustomOutputName</key>
        <string>TotalCount</string>
        <key>Input</key>
        ${this.actionOutputRef('SelectedPhotos')}
      </dict>
    </dict>

    <!-- Start notification -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>WFNotificationActionTitle</key>
        <string>myDrive Upload</string>
        <key>WFNotificationActionBody</key>
        <string>📤 Starting upload to your cloud…</string>
        <key>WFNotificationActionSound</key>
        <false/>
      </dict>
    </dict>

    <!-- Repeat with each selected photo -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.repeat.each</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>Input</key>
        ${this.actionOutputRef('SelectedPhotos')}
      </dict>
    </dict>

    <!-- LOOP: Get image name -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.getitemdetail</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>CustomOutputName</key>
        <string>FileName</string>
        <key>WFItemSpecifier</key>
        <string>Name</string>
        <key>WFInput</key>
        ${this.builtinVarRef('Repeat Item')}
      </dict>
    </dict>

    <!-- LOOP: Upload -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFURL</key>
        ${this.textToken(`${serverUrl}/api/v1/shortcuts/upload`)}
        <key>WFHTTPMethod</key>
        <string>POST</string>
        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              ${this.headerItem('X-Device-Id', deviceId)}
              ${this.headerItem('X-Device-Key', deviceKey)}
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
        <key>WFHTTPBodyType</key>
        <string>Form</string>
        <key>WFFormValues</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              <dict>
                <key>WFItemType</key>
                <integer>1</integer>
                <key>WFKey</key>
                ${this.textToken('media')}
                <key>WFValue</key>
                ${this.builtinVarRef('Repeat Item')}
              </dict>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                ${this.textToken('filename')}
                <key>WFValue</key>
                ${this.actionOutputRef('FileName')}
              </dict>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                ${this.textToken('deviceAssetId')}
                <key>WFValue</key>
                ${this.actionOutputRef('FileName')}
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>
      </dict>
    </dict>

    <!-- LOOP: Notify per file -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFNotificationActionTitle</key>
        <string>myDrive</string>
        <key>WFNotificationActionBody</key>
        <string>✅ Photo uploaded to your cloud</string>
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
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>GroupingIdentifier</key>
        <string>${loopGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>1</integer>
      </dict>
    </dict>

    <!-- Final notification -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.notification</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${this.uuid()}</string>
        <key>WFNotificationActionTitle</key>
        <string>myDrive Upload Complete</string>
        <key>WFNotificationActionBody</key>
        <string>🎉 All selected photos backed up to your personal cloud!</string>
        <key>WFNotificationActionSound</key>
        <true/>
      </dict>
    </dict>

  </array>

  <key>WFWorkflowClientVersion</key>
  <string>1300.0.0.0</string>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>900</string>
  <key>WFWorkflowName</key>
  <string>myDrive Upload</string>
  <key>WFWorkflowHasShortcutInputVariables</key>
  <true/>
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
    <string>WFAVAssetContentItem</string>
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
