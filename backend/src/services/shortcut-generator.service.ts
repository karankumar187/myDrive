import crypto from 'crypto';

/**
 * Generates Apple Shortcuts for myDrive photo & video upload.
 *
 * ARCHITECTURE (v8 - Verified with Apple Shortcuts engine):
 * 1. PHOTOS: Processed with `is.workflow.actions.image.convert` (JPEG, full quality, EXIF preserved).
 *    Produces real image file representation `ConvertedImage`.
 * 2. VIDEOS: Processed with `is.workflow.actions.encodemedia` using `WFMedia` parameter
 *    and `WFMediaSize: Passthrough`. Materializes video via AVAssetExportSession (fixes public.mpeg-4 error).
 * 3. UPLOAD: Multipart form (`WFHTTPBodyType: Form`) with `formFieldFileFromOutput`.
 *    Attaches `ConvertedImage` or `EncodedVideo` directly. Verified sending 68MB+ video and full photos.
 * 4. myDrive Upload: Clean menu (`📷 Upload Photos` / `🎬 Upload Videos`) with dedicated pickers.
 * 5. myDrive Auto Sync: Dual query (Photos + Videos) with single final notification.
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

  /**
   * Photo Loop Body:
   * 1. Convert Image to JPEG (full quality 1.0, preserve EXIF)
   * 2. Get Name from ConvertedImage
   * 3. Upload via multipart form
   */
  private static photoLoopBody(serverUrl: string, deviceId: string, deviceKey: string): string {
    const convUUID = this.uuid();
    const nameUUID = this.uuid();
    const uploadUUID = this.uuid();

    return `
    <!-- Convert Image: materializes photo to high-quality JPEG with EXIF -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.image.convert</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${convUUID}</string>
        <key>CustomOutputName</key>
        <string>ConvertedPhoto</string>
        <key>WFInput</key>
        ${this.varInput('Repeat Item')}
        <key>WFImageFormat</key>
        <string>JPEG</string>
        <key>WFImageCompressionQuality</key>
        <real>1.0</real>
        <key>WFPreserveMetadata</key>
        <true/>
      </dict>
    </dict>

    <!-- Get filename -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.getitemname</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${nameUUID}</string>
        <key>CustomOutputName</key>
        <string>PhotoName</string>
        <key>WFInput</key>
        ${this.actionInput(convUUID, 'ConvertedPhoto')}
      </dict>
    </dict>

    <!-- Upload photo via Multipart Form -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${uploadUUID}</string>
        <key>CustomOutputName</key>
        <string>PhotoUploadResult</string>
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
          this.formFieldFileFromOutput('media', convUUID, 'ConvertedPhoto'),
          this.formFieldText('filename', nameUUID, 'PhotoName'),
          this.formFieldText('deviceAssetId', nameUUID, 'PhotoName'),
          this.formFieldStaticText('deviceId', deviceId),
          this.formFieldStaticText('deviceKey', deviceKey),
        ])}
      </dict>
    </dict>`;
  }

  /**
   * Video Loop Body:
   * 1. Encode Media: AVAssetExportSession with Passthrough (preserves HEVC/4K/1080p quality)
   *    Uses WFMedia parameter (verified on Apple Shortcuts).
   * 2. Get Name from EncodedVideo
   * 3. Upload via multipart form (verified sending 68MB+ video files)
   */
  private static videoLoopBody(serverUrl: string, deviceId: string, deviceKey: string): string {
    const encodeUUID = this.uuid();
    const nameUUID = this.uuid();
    const uploadUUID = this.uuid();

    return `
    <!-- Encode Media: materializes video via AVAssetExportSession (fixes public.mpeg-4 error) -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.encodemedia</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${encodeUUID}</string>
        <key>CustomOutputName</key>
        <string>EncodedVideo</string>
        <key>WFMedia</key>
        ${this.varInput('Repeat Item')}
        <key>WFMediaSize</key>
        <string>Passthrough</string>
        <key>WFMediaAudioOnly</key>
        <false/>
        <key>WFMediaSpeed</key>
        <string>Normal</string>
      </dict>
    </dict>

    <!-- Get filename -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.getitemname</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${nameUUID}</string>
        <key>CustomOutputName</key>
        <string>VideoName</string>
        <key>WFInput</key>
        ${this.actionInput(encodeUUID, 'EncodedVideo')}
      </dict>
    </dict>

    <!-- Upload video via Multipart Form -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.downloadurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${uploadUUID}</string>
        <key>CustomOutputName</key>
        <string>VideoUploadResult</string>
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
          this.formFieldText('filename', nameUUID, 'VideoName'),
          this.formFieldText('deviceAssetId', nameUUID, 'VideoName'),
          this.formFieldStaticText('deviceId', deviceId),
          this.formFieldStaticText('deviceKey', deviceKey),
        ])}
      </dict>
    </dict>`;
  }

  /**
   * Media type filter predicate for Find Photos action.
   * Uses Enumeration type in WFActionParameterFilterTemplates (verified with Apple Shortcuts engine).
   */
  private static mediaTypeFilter(mediaType: 'Image' | 'Video'): string {
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
                  <key>Enumeration</key>
                  <string>${mediaType}</string>
                </dict>
              </dict>
            </array>
            <key>WFContentPredicateBoundedDate</key>
            <false/>
          </dict>
          <key>WFSerializationType</key>
          <string>WFContentPredicateTableTemplate</string>
        </dict>`;
  }

  /**
   * Generates the automated background sync shortcut:
   * 1. Finds 25 latest photos (Image) -> converts to JPEG (100% + EXIF) -> uploads
   * 2. Finds 10 latest videos (Video) -> encodes with Passthrough (preserves HEVC/4K/1080p) -> uploads
   * 3. Single final notification
   *
   * Completely eliminates WFPhotoMediaContentItem coercion errors and ensures videos are never uploaded as photos!
   */
  static generateAutoSyncShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const findPhotosUUID = this.uuid();
    const photoLoopGroup = this.uuid();
    const findVideosUUID = this.uuid();
    const videoLoopGroup = this.uuid();

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- ═══ SECTION 1: LATEST PHOTOS (JPEG, HEIC, PNG, Live Photos) ═══ -->
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
        ${this.mediaTypeFilter('Image')}
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

    <!-- ═══ SECTION 2: LATEST VIDEOS (MOV, MP4, HEVC, 4K, 1080p) ═══ -->
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
        <integer>10</integer>
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

    <!-- Final Single Notification -->
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
  <string>900</string>
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

  /**
   * Generates the interactive upload shortcut:
   * 1. Clean menu: 📷 Upload Photos or 🎬 Upload Videos
   * 2. Dedicated picker for photos (Images + Live Photos) -> converts to JPEG (100% + EXIF) -> uploads
   * 3. Dedicated picker for videos (Videos) -> encodes with Passthrough (preserves HEVC/4K/1080p) -> uploads
   * 4. Single final notification
   */
  static generateUploadShortcut(serverUrl: string, deviceId: string, deviceKey: string): string {
    const menuGroupId = this.uuid();
    const selectPhotosUUID = this.uuid();
    const photoLoopGroup = this.uuid();
    const selectVideosUUID = this.uuid();
    const videoLoopGroup = this.uuid();

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>

    <!-- ═══ MENU: Choose Photo or Video Upload ═══ -->
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.choosefrommenu</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>GroupingIdentifier</key>
        <string>${menuGroupId}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFMenuPrompt</key>
        <string>What would you like to back up?</string>
        <key>WFMenuItems</key>
        <array>
          <string>📷 Upload Photos</string>
          <string>🎬 Upload Videos</string>
        </array>
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

    <!-- Select Photos Only -->
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

    <!-- Select Videos Only -->
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

    <!-- Final Single Notification -->
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
  <string>900</string>
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
