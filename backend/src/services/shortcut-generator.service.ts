import crypto from 'crypto';

/**
 * Generates fully pre-configured Apple Shortcuts .shortcut plist files.
 *
 * VIDEO FIX: Videos from the Photos library (PHAsset) cannot produce file representations
 * via the normal path — "WFPhotoMediaContentItem produced no file representation for type
 * com.apple.quicktime-movie". Fix: detect videos by filename extension (case-insensitive),
 * then use `is.workflow.actions.encodemedia` to materialize the PHAsset to a real file.
 * Photos are uploaded directly (Encode Media fails on images).
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

  /** Static text token (WFTextTokenString with empty attachmentsByRange) */
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

  /** Variable reference token (WFTextTokenString with \uFFFC placeholder) */
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

  /** Action input attachment (WFTextTokenAttachment referencing action output by UUID) */
  private static actionInput(outputUUID: string, outputName: string, coercionClass?: string): string {
    const aggrandizements = coercionClass
      ? `
                <key>Aggrandizements</key>
                <array>
                  <dict>
                    <key>CoercionItemClass</key>
                    <string>${this.esc(coercionClass)}</string>
                    <key>Type</key>
                    <string>WFCoercionVariableAggrandizement</string>
                  </dict>
                </array>`
      : '';

    return `<dict>
              <key>Value</key>
              <dict>${aggrandizements}
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

  /** Variable input attachment (references a magic variable like "Repeat Item") */
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

  /** Magic variable reference (WFTextTokenString for use in string interpolation contexts) */
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

  /** HTTP header key-value pair */
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

  /** Text form field referencing an action output */
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

  /** Static text form field */
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

  /** File attachment form field (WFItemType 5) referencing a named variable */
  private static formFieldFile(key: string, variableName: string = 'Repeat Item'): string {
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

  /** File attachment form field (WFItemType 5) referencing an action output */
  private static formFieldFileFromOutput(key: string, outputUUID: string, outputName: string): string {
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
                    <string>${this.esc(outputName)}</string>
                    <key>OutputUUID</key>
                    <string>${outputUUID}</string>
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

  /** Dictionary field value container */
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

  // ─────────────────────────────────────────────────────────────
  //  VIDEO EXTENSION CHECK BLOCK
  // ─────────────────────────────────────────────────────────────

  /**
   * Generates a flat If/End If block that checks if the lowercased filename
   * contains a given video extension. If matched, runs Encode Media to
   * materialize the PHAsset video, then sets "MediaFile" to the encoded output.
   *
   * Each block is independent (no nesting). For a photo, none match →
   * MediaFile stays as Repeat Item. For a video, exactly one matches →
   * MediaFile gets overwritten with the encoded output.
   */
  private static videoExtCheck(ext: string, lowerCaseUUID: string): string {
    const ifGroup = this.uuid();
    const encodeId = this.uuid();

    return `
    <!-- If video: .${ext} -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.conditional</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${ifGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFInput</key>
        <dict>
          <key>Type</key>
          <string>Variable</string>
          <key>Variable</key>
          ${this.actionInput(lowerCaseUUID, 'LowerName')}
        </dict>
        <key>WFCondition</key>
        <integer>4</integer>
        <key>WFConditionalActionString</key>
        <string>.${ext}</string>
      </dict>
    </dict>

    <!-- Encode Media: materialize video PHAsset via AVAssetExportSession -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.encodemedia</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${encodeId}</string>
        <key>CustomOutputName</key>
        <string>Encoded_${ext}</string>
        <key>WFInput</key>
        ${this.varInput('Repeat Item')}
        <key>WFMediaAudioOnly</key>
        <false/>
      </dict>
    </dict>

    <!-- Set MediaFile = encoded video output -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.setvariable</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFInput</key>
        ${this.actionInput(encodeId, 'Encoded_' + ext)}
        <key>WFVariableName</key>
        <string>MediaFile</string>
      </dict>
    </dict>

    <!-- End If (.${ext}) -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.conditional</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${ifGroup}</string>
        <key>WFControlFlowMode</key>
        <integer>2</integer>
      </dict>
    </dict>`;
  }

  // ─────────────────────────────────────────────────────────────
  //  SHARED LOOP BODY
  // ─────────────────────────────────────────────────────────────

  /**
   * Generates the complete loop body that handles BOTH photos and videos:
   *
   *   1. Get Name of Repeat Item → FileName
   *   2. Change Case to lowercase → LowerName
   *   3. Set Variable "MediaFile" = Repeat Item (default: photo, direct upload)
   *   4. For each video extension (.mov .mp4 .m4v .3gp .avi .mkv .webm .hevc):
   *        If LowerName contains ".ext":
   *          Encode Media → set MediaFile = encoded output
   *        End If
   *   5. Upload "MediaFile" with filename "FileName"
   *
   * Each extension check is a FLAT independent If/End If block (no nesting).
   * Photos: none match → MediaFile stays as Repeat Item → direct upload.
   * Videos: one matches → MediaFile becomes encoded file → upload works.
   */
  private static generateLoopBody(
    serverUrl: string,
    deviceId: string,
    deviceKey: string,
  ): string {
    const nameUUID = this.uuid();
    const lowerCaseUUID = this.uuid();
    const uploadUUID = this.uuid();

    // All video container formats that can hold HEVC + other common codecs
    const videoExtensions = [
      'mov',   // iPhone camera (HEVC H.265, H.264), QuickTime
      'mp4',   // MPEG-4 (HEVC, H.264, AV1)
      'm4v',   // Apple video (HEVC, H.264, iTunes)
      '3gp',   // Mobile video (H.264, H.263)
      'avi',   // AVI container
      'mkv',   // Matroska (HEVC, H.264, VP9, AV1)
      'webm',  // WebM (VP8, VP9, AV1)
    ];

    return `
    <!-- LOOP: Get filename (works for both photos & videos — no file bytes needed) -->
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

    <!-- LOOP: Lowercase filename for case-insensitive extension matching -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.text.changecase</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${lowerCaseUUID}</string>
        <key>CustomOutputName</key>
        <string>LowerName</string>
        <key>WFCaseType</key>
        <string>lowercase</string>
        <key>text</key>
        ${this.actionInput(nameUUID, 'FileName')}
      </dict>
    </dict>

    <!-- DEFAULT: Set MediaFile = Repeat Item (photo: direct upload, no encoding) -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.setvariable</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFInput</key>
        ${this.varInput('Repeat Item')}
        <key>WFVariableName</key>
        <string>MediaFile</string>
      </dict>
    </dict>

    <!-- VIDEO DETECTION: Check each video extension independently (flat, no nesting).
         If matched, Encode Media materializes the PHAsset video to a real file,
         then overwrites MediaFile with the encoded output.
         Photos: no match → MediaFile stays as Repeat Item → direct upload. -->
    ${videoExtensions.map(ext => this.videoExtCheck(ext, lowerCaseUUID)).join('')}

    <!-- LOOP: Upload MediaFile (photos direct, videos via Encode Media) -->
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
          this.formFieldFile('media', 'MediaFile'),
          this.formFieldText('filename', nameUUID, 'FileName'),
          this.formFieldText('deviceAssetId', nameUUID, 'FileName'),
          this.formFieldStaticText('deviceId', deviceId),
          this.formFieldStaticText('deviceKey', deviceKey),
        ])}
      </dict>
    </dict>`;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  AUTO-SYNC SHORTCUT
  // ═══════════════════════════════════════════════════════════════════

  static generateAutoSyncShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const findPhotosUUID = this.uuid();
    const countUUID = this.uuid();
    const loopGroupId = this.uuid();

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
        <string>${findPhotosUUID}</string>
        <key>CustomOutputName</key>
        <string>NewPhotos</string>
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

    <!-- Count -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.count</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${countUUID}</string>
        <key>CustomOutputName</key>
        <string>TotalCount</string>
        <key>Input</key>
        ${this.actionInput(findPhotosUUID, 'NewPhotos')}
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
        ${this.actionInput(findPhotosUUID, 'NewPhotos')}
      </dict>
    </dict>

    ${this.generateLoopBody(serverUrl, deviceId, deviceKey)}

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

  // ═══════════════════════════════════════════════════════════════════
  //  MANUAL UPLOAD SHORTCUT
  // ═══════════════════════════════════════════════════════════════════

  static generateUploadShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const selectPhotosUUID = this.uuid();
    const countUUID = this.uuid();
    const loopGroupId = this.uuid();

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
        <string>${selectPhotosUUID}</string>
        <key>CustomOutputName</key>
        <string>SelectedPhotos</string>
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

    <!-- Count -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.count</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${countUUID}</string>
        <key>CustomOutputName</key>
        <string>TotalCount</string>
        <key>Input</key>
        ${this.actionInput(selectPhotosUUID, 'SelectedPhotos')}
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

    ${this.generateLoopBody(serverUrl, deviceId, deviceKey)}

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
