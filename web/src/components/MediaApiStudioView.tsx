import React, { useState, useEffect } from 'react';
import {
  Key,
  Code2,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  Plus,
  RefreshCw,
  Sliders,
  Image as ImageIcon,
  Layers,
  Terminal,
  FileText,
  AlertTriangle,
  Folder,
  Tag,
  Upload,
  UploadCloud,
  CheckCircle2,
  Wand2,
  ArrowLeft,
  X,
  Download,
  Eye,
  Play,
  Filter,
  Loader2,
} from 'lucide-react';
import { api } from '../services/api.js';
import { ApiKeyItem, MediaAssetItem, User } from '../types.js';
import { formatBytes } from '../utils/format.js';

interface MediaApiStudioViewProps {
  currentUser: User | null;
  onBackToDashboard?: () => void;
}

type StudioTab = 'keys' | 'docs' | 'playground' | 'assets' | 'upload';

export const MediaApiStudioView: React.FC<MediaApiStudioViewProps> = ({ currentUser, onBackToDashboard }) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('keys');
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [cloudName, setCloudName] = useState<string>('drive');
  const [mediaAssets, setMediaAssets] = useState<MediaAssetItem[]>([]);
  const [totalMediaCount, setTotalMediaCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Lightbox Media Viewer Modal state
  const [activeModalAsset, setActiveModalAsset] = useState<MediaAssetItem | null>(null);

  // New Key Modal state
  const [isNewKeyModalOpen, setIsNewKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdSecretData, setCreatedSecretData] = useState<{
    apiKey: string;
    apiSecret: string;
    name: string;
  } | null>(null);

  // Edit Cloud Name modal
  const [isCloudNameModalOpen, setIsCloudNameModalOpen] = useState(false);
  const [editCloudNameInput, setEditCloudNameInput] = useState('');

  // Code Snippet language tab
  const [selectedLanguage, setSelectedLanguage] = useState<'curl' | 'javascript' | 'react' | 'nodejs' | 'python'>('curl');

  // Transformation Studio state
  const [selectedImage, setSelectedImage] = useState<string>('');
  const [transformWidth, setTransformWidth] = useState<number>(400);
  const [transformHeight, setTransformHeight] = useState<number>(400);
  const [transformCrop, setTransformCrop] = useState<'fill' | 'fit' | 'crop' | 'scale' | 'thumb'>('fill');
  const [transformFormat, setTransformFormat] = useState<'auto' | 'webp' | 'png' | 'jpeg' | 'avif'>('auto');
  const [transformQuality, setTransformQuality] = useState<number>(82);
  const [transformGrayscale, setTransformGrayscale] = useState<boolean>(false);
  const [transformBlur, setTransformBlur] = useState<number>(0);
  const [transformRadius, setTransformRadius] = useState<'none' | 'rounded' | 'max'>('none');

  // Debounced transformation preview
  const [debouncedTransformUrl, setDebouncedTransformUrl] = useState<string>('');
  const [isTransforming, setIsTransforming] = useState<boolean>(false);

  // Test Upload Box state
  const [uploadFolder, setUploadFolder] = useState<string>('webapp');
  const [uploadTags, setUploadTags] = useState<string>('banner, media');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadResponseJson, setUploadResponseJson] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Filter state for assets library
  const [assetSearch, setAssetSearch] = useState('');
  const [assetFolderFilter, setAssetFolderFilter] = useState('');
  const [assetTypeFilter, setAssetTypeFilter] = useState<'all' | 'image' | 'video' | 'pdf'>('all');
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState<number>(48);

  const rawApiBase = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
  const apiBase = rawApiBase ? `${rawApiBase}/api/v1` : `${window.location.origin}/api/v1`;

  // File type helpers
  const isImageAsset = (asset: MediaAssetItem) => {
    const ext = (asset.format || '').toLowerCase();
    return asset.resource_type === 'image' || ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg'].includes(ext);
  };

  const isPdfAsset = (asset: MediaAssetItem) => {
    const ext = (asset.format || '').toLowerCase();
    return ext === 'pdf' || asset.public_id.toLowerCase().endsWith('.pdf');
  };

  const isVideoAsset = (asset: MediaAssetItem) => {
    const ext = (asset.format || '').toLowerCase();
    return asset.resource_type === 'video' || ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext);
  };

  const resolveAssetUrl = (url: string | undefined, publicId: string) => {
    if (!url) return `${apiBase}/media/${publicId}`;
    if (url.startsWith('https://')) return url;
    return url.replace(/^http:\/\/[^/]+\/api\/v1/, apiBase);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2500);
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [keysRes, mediaRes] = await Promise.all([
        api.getDeveloperKeys().catch(() => ({ cloudName: 'drive', keys: [] })),
        api.getMediaAssets({ limit: 1000 }).catch(() => ({ resources: [], total: 0 })),
      ]);
      setKeys(keysRes.keys || []);
      if (keysRes.cloudName) setCloudName(keysRes.cloudName);
      const resources = mediaRes.resources || [];
      setMediaAssets(resources);
      setTotalMediaCount(mediaRes.total || resources.length);

      if (resources.length > 0 && !selectedImage) {
        // Select an image first for the transformation playground
        const firstImg = resources.find((a) => {
          const ext = (a.format || '').toLowerCase();
          return a.resource_type === 'image' || ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg'].includes(ext);
        });
        setSelectedImage(firstImg ? firstImg.public_id : resources[0].public_id);
      }
    } catch (err) {
      console.error('Failed to load developer studio data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Keyboard shortcut listener (Escape to close modal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveModalAsset(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    try {
      const res = await api.createDeveloperKey(newKeyName.trim());
      setCreatedSecretData({
        apiKey: res.key.apiKey,
        apiSecret: res.key.apiSecret,
        name: res.key.name,
      });
      setNewKeyName('');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to generate API Key');
    }
  };

  const handleRevokeKey = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to revoke API key "${name}"? Apps using this key will immediately lose access.`)) {
      return;
    }
    try {
      await api.revokeDeveloperKey(id);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke key');
    }
  };

  const handleUpdateCloudName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCloudNameInput.trim()) return;
    try {
      const res = await api.updateCloudName(editCloudNameInput.trim());
      setCloudName(res.cloudName);
      setIsCloudNameModalOpen(false);
    } catch (err: any) {
      alert(err.message || 'Failed to update cloud name');
    }
  };

  const handleDeleteAsset = async (publicId: string) => {
    if (!window.confirm(`Permanently delete media asset "${publicId}"?`)) return;
    try {
      await api.deleteMediaAsset(publicId);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete asset');
    }
  };

  const handleTestUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus('Uploading media file via API...');
    setUploadResponseJson(null);

    try {
      const res = await api.uploadMediaAsset(file, uploadFolder, uploadTags);
      setUploadStatus('Upload successful! Asset registered in myDrive Media:');
      setUploadResponseJson(JSON.stringify(res, null, 2));
      loadData();
    } catch (err: any) {
      setUploadStatus(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Transformation URL calculation
  const getTransformPathString = () => {
    const parts: string[] = [];
    if (transformWidth) parts.push(`w_${transformWidth}`);
    if (transformHeight) parts.push(`h_${transformHeight}`);
    if (transformCrop) parts.push(`c_${transformCrop}`);
    if (transformFormat && transformFormat !== 'auto') parts.push(`f_${transformFormat}`);
    if (transformQuality && transformQuality !== 82) parts.push(`q_${transformQuality}`);
    if (transformGrayscale) parts.push('e_grayscale');
    if (transformBlur > 0) parts.push(`e_blur:${transformBlur}`);
    if (transformRadius === 'max') parts.push('r_max');
    else if (transformRadius === 'rounded') parts.push('r_24');
    return parts.join(',');
  };

  const activeTransformPath = getTransformPathString();
  const effectivePublicId = selectedImage || (mediaAssets[0]?.public_id ?? 'sample');
  const targetTransformedUrl = activeTransformPath
    ? `${apiBase}/media/image/upload/${activeTransformPath}/${effectivePublicId}`
    : `${apiBase}/media/${effectivePublicId}`;

  // Debounce preview transformed URL to eliminate slider lag
  useEffect(() => {
    setIsTransforming(true);
    const timer = setTimeout(() => {
      setDebouncedTransformUrl(targetTransformedUrl);
    }, 300);
    return () => clearTimeout(timer);
  }, [targetTransformedUrl]);

  const previewTransformedUrl = debouncedTransformUrl || targetTransformedUrl;

  // Sample API key for docs
  const sampleKey = keys[0]?.apiKey || 'cld_live_your_api_key_here';
  const sampleSecret = 'sec_live_your_api_secret_here';

  // Code snippets
  const getCodeSnippet = () => {
    switch (selectedLanguage) {
      case 'curl':
        return `# 1. Programmatic Media Upload via cURL
curl -X POST "${apiBase}/media/upload" \\
  -H "X-API-Key: ${sampleKey}" \\
  -H "X-API-Secret: ${sampleSecret}" \\
  -F "file=@/path/to/image.jpg" \\
  -F "folder=products" \\
  -F "tags=hero,ecommerce"

# 2. Dynamic Image Transformation & CDN Delivery
# Format: /media/image/upload/w_300,h_300,c_fill,f_webp/<public_id>
curl "${apiBase}/media/image/upload/w_300,h_300,c_fill,f_webp,q_80/products/hero-image.webp" \\
  --output hero-thumb.webp`;

      case 'javascript':
        return `// Upload media programmatically using standard fetch
async function uploadMedia(file, folder = 'uploads', tags = ['media']) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);
  formData.append('tags', tags.join(','));

  const response = await fetch('${apiBase}/media/upload', {
    method: 'POST',
    headers: {
      'X-API-Key': '${sampleKey}',
      'X-API-Secret': '${sampleSecret}',
    },
    body: formData,
  });

  if (!response.ok) throw new Error('Upload failed: ' + response.statusText);
  const data = await response.json();
  
  console.log('Uploaded asset URL:', data.secure_url);
  console.log('Dynamic thumbnail:', data.thumbnail_url);
  return data;
}`;

      case 'react':
        return `import React, { useState } from 'react';

export function MediaUploadWidget() {
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'avatars');

    const res = await fetch('${apiBase}/media/upload', {
      method: 'POST',
      headers: {
        'X-API-Key': '${sampleKey}',
        'X-API-Secret': '${sampleSecret}',
      },
      body: formData,
    });

    const data = await res.json();
    setImageUrl(data.secure_url);
    setLoading(false);
  };

  return (
    <div className="p-4 border rounded-xl">
      <input type="file" accept="image/*" onChange={handleFileChange} />
      {loading && <p>Transforming & Uploading...</p>}
      {imageUrl && (
        <img
          src={imageUrl}
          alt="Uploaded"
          className="w-48 h-48 object-cover rounded-lg mt-3"
        />
      )}
    </div>
  );
}`;

      case 'nodejs':
        return `import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

async function uploadLocalMedia(filePath, folder = 'backend-uploads') {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('folder', folder);
  form.append('tags', 'automated,sync');

  const res = await fetch('${apiBase}/media/upload', {
    method: 'POST',
    headers: {
      'X-API-Key': '${sampleKey}',
      'X-API-Secret': '${sampleSecret}',
      ...form.getHeaders(),
    },
    body: form,
  });

  const result = await res.json();
  console.log('Asset stored in unified pooled drive:', result);
  return result;
}`;

      case 'python':
        return `import requests

def upload_media(file_path, folder="python_media"):
    url = "${apiBase}/media/upload"
    headers = {
        "X-API-Key": "${sampleKey}",
        "X-API-Secret": "${sampleSecret}",
    }
    with open(file_path, "rb") as f:
        files = {"file": f}
        data = {"folder": folder, "tags": "python,api"}
        response = requests.post(url, headers=headers, files=files, data=data)
        
    response.raise_for_status()
    payload = response.json()
    print("Direct URL:", payload["secure_url"])
    print("Auto WebP Thumbnail:", payload["thumbnail_url"])
    return payload`;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-900 text-slate-100 overflow-y-auto">
      {/* Top Header Banner */}
      <div className="border-b border-slate-800 bg-slate-950/60 p-6 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  myDrive Media Studio
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-mono">
                    v1 API
                  </span>
                </h1>
                <p className="text-sm text-slate-400">
                  Programmatic media storage, API keys, real-time transformations, and CDN delivery powered by your unified pooled Google Drive accounts.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-800/80 border border-slate-700/60 rounded-xl px-3 py-1.5 text-xs text-slate-300">
              <span className="text-slate-500 mr-1.5 font-medium">Cloud Name:</span>
              <span className="font-mono text-indigo-400 font-semibold">{cloudName}</span>
              <button
                onClick={() => {
                  setEditCloudNameInput(cloudName);
                  setIsCloudNameModalOpen(true);
                }}
                className="ml-2 text-slate-400 hover:text-white underline text-[11px]"
              >
                Edit
              </button>
            </div>

            {onBackToDashboard && (
              <button
                onClick={onBackToDashboard}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800/90 hover:bg-slate-750 text-slate-300 hover:text-white text-xs font-medium rounded-xl border border-slate-700/60 transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </button>
            )}

            <button
              onClick={() => setIsNewKeyModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-indigo-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create API Key
            </button>
          </div>
        </div>

        {/* Stats Strip */}
        <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <div className="bg-slate-850 border border-slate-800/80 rounded-xl p-3">
            <div className="text-xs text-slate-400 font-medium">Active API Keys</div>
            <div className="text-xl font-bold text-white mt-0.5 font-mono">
              {keys.filter((k) => k.isActive).length}
            </div>
          </div>
          <div className="bg-slate-850 border border-slate-800/80 rounded-xl p-3">
            <div className="text-xs text-slate-400 font-medium">Media Assets</div>
            <div className="text-xl font-bold text-white mt-0.5 font-mono">
              {totalMediaCount || mediaAssets.length}
            </div>
          </div>
          <div className="bg-slate-850 border border-slate-800/80 rounded-xl p-3">
            <div className="text-xs text-slate-400 font-medium">API Requests Handled</div>
            <div className="text-xl font-bold text-indigo-400 mt-0.5 font-mono">
              {keys.reduce((sum, k) => sum + (k.requestCount || 0), 0)}
            </div>
          </div>
          <div className="bg-slate-850 border border-slate-800/80 rounded-xl p-3">
            <div className="text-xs text-slate-400 font-medium">Underlying Storage</div>
            <div className="text-sm font-semibold text-emerald-400 mt-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Pooled Google Drive
            </div>
          </div>
        </div>

        {/* Sub Navigation Tabs */}
        <div className="max-w-7xl mx-auto flex items-center gap-2 mt-6 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setActiveTab('keys')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'keys'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Key className="w-4 h-4" />
            API Keys
          </button>
          <button
            onClick={() => setActiveTab('playground')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'playground'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Transformation Studio
          </button>
          <button
            onClick={() => setActiveTab('docs')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'docs'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Code2 className="w-4 h-4" />
            Code & Integration
          </button>
          <button
            onClick={() => setActiveTab('assets')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'assets'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            Media Assets ({totalMediaCount || mediaAssets.length})
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'upload'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            API Test Dropzone
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto w-full p-6 space-y-6">
        {/* TAB 1: API KEYS */}
        {activeTab === 'keys' && (
          <div className="space-y-6">
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Developer API Keys</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Use these credentials in your headers (`X-API-Key` and `X-API-Secret`) to upload and manage media from your webapps.
                  </p>
                </div>
                <button
                  onClick={loadData}
                  disabled={isLoading}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition"
                  title="Refresh keys"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {keys.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl">
                  <Key className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <h3 className="text-base font-semibold text-white">No API Keys Generated</h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
                    Create an API key to start uploading images, videos, and media programmatically from your external applications.
                  </p>
                  <button
                    onClick={() => setIsNewKeyModalOpen(true)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Generate First API Key
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900/80 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Key Name / App</th>
                        <th className="py-3 px-4">API Key</th>
                        <th className="py-3 px-4">API Secret</th>
                        <th className="py-3 px-4">Requests</th>
                        <th className="py-3 px-4">Last Used</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {keys.map((k) => (
                        <tr key={k._id} className="hover:bg-slate-900/50 transition">
                          <td className="py-3.5 px-4 font-medium text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                            {k.name}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-slate-300">
                            <div className="flex items-center gap-1.5">
                              <span>{k.apiKey}</span>
                              <button
                                onClick={() => copyToClipboard(k.apiKey, `key_${k._id}`)}
                                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                                title="Copy API Key"
                              >
                                {copiedText === `key_${k._id}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-slate-500">
                            {k.apiSecretPrefix}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-indigo-400 font-semibold">
                            {k.requestCount.toLocaleString()}
                          </td>
                          <td className="py-3.5 px-4 text-slate-400">
                            {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() => handleRevokeKey(k._id, k.name)}
                              className="px-2.5 py-1 text-rose-400 hover:text-white hover:bg-rose-500/20 border border-rose-500/30 rounded-lg text-[11px] font-medium transition cursor-pointer"
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Quick Environment Variables Card */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-semibold text-white">Environment Configuration (.env)</h3>
                </div>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `MYDRIVE_MEDIA_KEY=${sampleKey}\nMYDRIVE_MEDIA_SECRET=${sampleSecret}\nMYDRIVE_MEDIA_URL=${apiBase}/media\n# Drop-in Cloudinary SDK compatibility:\nCLOUDINARY_CLOUD_NAME=${cloudName}\nCLOUDINARY_API_KEY=${sampleKey}\nCLOUDINARY_API_SECRET=${sampleSecret}`,
                      'env_snippet'
                    )
                  }
                  className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                >
                  {copiedText === 'env_snippet' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy .env block
                </button>
              </div>
              <pre className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl font-mono text-xs text-slate-300 overflow-x-auto">
                {`MYDRIVE_MEDIA_KEY=${sampleKey}
MYDRIVE_MEDIA_SECRET=${sampleSecret}
MYDRIVE_MEDIA_URL=${apiBase}/media

# Optional: Drop-in Cloudinary SDK Compatibility
CLOUDINARY_CLOUD_NAME=${cloudName}
CLOUDINARY_API_KEY=${sampleKey}
CLOUDINARY_API_SECRET=${sampleSecret}`}
              </pre>
            </div>
          </div>
        )}

        {/* TAB 2: TRANSFORMATION STUDIO (PLAYGROUND) */}
        {activeTab === 'playground' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Controls Column */}
            <div className="lg:col-span-5 space-y-5 bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Wand2 className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-semibold text-white">Dynamic Transformations</h2>
              </div>

              {/* Source Asset Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Select Source Media Asset
                </label>
                {mediaAssets.length === 0 ? (
                  <div className="text-xs text-slate-500 bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                    No media assets uploaded yet. Upload an asset or use a test ID below.
                  </div>
                ) : (
                  <select
                    value={selectedImage}
                    onChange={(e) => setSelectedImage(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    {mediaAssets.filter(isImageAsset).length > 0 && (
                      <optgroup label="Images (Real-time Sharp Transformations)">
                        {mediaAssets.filter(isImageAsset).map((asset) => (
                          <option key={asset.public_id} value={asset.public_id}>
                            {asset.public_id} ({asset.format.toUpperCase()})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {mediaAssets.filter((a) => !isImageAsset(a)).length > 0 && (
                      <optgroup label="Documents & Other Media">
                        {mediaAssets.filter((a) => !isImageAsset(a)).map((asset) => (
                          <option key={asset.public_id} value={asset.public_id}>
                            {asset.public_id} ({asset.format.toUpperCase()})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>

              {/* Sliders: Width & Height */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Width: {transformWidth}px</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={1200}
                    step={10}
                    value={transformWidth}
                    onChange={(e) => setTransformWidth(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Height: {transformHeight}px</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={1200}
                    step={10}
                    value={transformHeight}
                    onChange={(e) => setTransformHeight(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Crop Mode Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Crop & Resize Mode (c_)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'fill', label: 'c_fill (Cover)' },
                    { id: 'fit', label: 'c_fit (Contain)' },
                    { id: 'thumb', label: 'c_thumb (Smart)' },
                    { id: 'crop', label: 'c_crop' },
                    { id: 'scale', label: 'c_scale' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setTransformCrop(m.id as any)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono transition border ${
                        transformCrop === m.id
                          ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/60'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Output Format & Quality */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Target Format (f_)
                  </label>
                  <select
                    value={transformFormat}
                    onChange={(e) => setTransformFormat(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    <option value="auto">f_auto (WebP/AVIF)</option>
                    <option value="webp">f_webp (Modern)</option>
                    <option value="avif">f_avif (Next-Gen)</option>
                    <option value="png">f_png (Lossless)</option>
                    <option value="jpeg">f_jpeg (Standard)</option>
                  </select>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                    <span>Quality (q_): {transformQuality}%</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={transformQuality}
                    onChange={(e) => setTransformQuality(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer mt-1"
                  />
                </div>
              </div>

              {/* Visual Effects (Grayscale, Blur, Rounded) */}
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={transformGrayscale}
                      onChange={(e) => setTransformGrayscale(e.target.checked)}
                      className="rounded accent-indigo-500"
                    />
                    Grayscale Filter (e_grayscale)
                  </label>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Blur (e_blur): {transformBlur > 0 ? `${transformBlur}px` : 'Off'}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={15}
                    step={0.5}
                    value={transformBlur}
                    onChange={(e) => setTransformBlur(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Corner Radius (r_)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'none', label: 'Square (0)' },
                      { id: 'rounded', label: 'Rounded (24px)' },
                      { id: 'max', label: 'Circle (r_max)' },
                    ].map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setTransformRadius(r.id as any)}
                        className={`px-2 py-1 rounded-lg text-xs font-mono transition border ${
                          transformRadius === r.id
                            ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/60'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Preview Column */}
            <div className="lg:col-span-7 space-y-4 flex flex-col">
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-indigo-400" />
                    Real-time Transformed Output
                  </h3>
                  <a
                    href={previewTransformedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  >
                    Open Fullscreen <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Transformed Image Frame */}
                <div className="flex-1 min-h-[300px] flex items-center justify-center bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 overflow-hidden relative checkerboard-bg">
                  {isTransforming && (
                    <div className="absolute top-3 right-3 z-10 px-2.5 py-1 bg-slate-900/90 border border-slate-700 text-indigo-400 rounded-lg text-xs flex items-center gap-1.5 shadow-lg backdrop-blur">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Transforming...</span>
                    </div>
                  )}

                  {effectivePublicId && effectivePublicId !== 'sample' ? (
                    isPdfAsset({ public_id: effectivePublicId } as any) ? (
                      <div className="flex flex-col items-center justify-center p-6 text-center">
                        <FileText className="w-16 h-16 text-rose-400 mb-3" />
                        <h4 className="text-sm font-semibold text-white">Document Asset Selected</h4>
                        <p className="text-xs text-slate-400 max-w-sm mt-1 mb-3">
                          On-the-fly Sharp transformations (resize, crop, blur, format conversion) apply to image assets (JPG, PNG, WebP, AVIF, GIF).
                        </p>
                        <a
                          href={`${apiBase}/media/${effectivePublicId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> View PDF Document
                        </a>
                      </div>
                    ) : (
                      <img
                        key={previewTransformedUrl}
                        src={previewTransformedUrl}
                        alt="Transformed Preview"
                        onLoad={() => setIsTransforming(false)}
                        onError={() => setIsTransforming(false)}
                        className={`max-h-[360px] max-w-full object-contain shadow-2xl rounded transition-opacity duration-200 ${
                          isTransforming ? 'opacity-70' : 'opacity-100'
                        }`}
                      />
                    )
                  ) : (
                    <div className="text-center text-slate-500 text-xs">
                      Upload an asset to preview live transformations.
                    </div>
                  )}
                </div>

                {/* Generated Transformation URL Box */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Generated Delivery URL:</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(previewTransformedUrl, 'url')}
                        className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
                      >
                        {copiedText === 'url' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        Copy URL
                      </button>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `<img src="${previewTransformedUrl}" alt="Media" width="${transformWidth}" height="${transformHeight}" loading="lazy" />`,
                            'html'
                          )
                        }
                        className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
                      >
                        {copiedText === 'html' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        Copy &lt;img&gt;
                      </button>
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 font-mono text-xs text-emerald-400 break-all select-all">
                    {previewTransformedUrl}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CODE & INTEGRATION DOCS */}
        {activeTab === 'docs' && (
          <div className="space-y-6">
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-white">Integration Guides & SDK Snippets</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Copy and paste ready-to-run code snippets into your frontend webapp, backend server, or scripts.
                  </p>
                </div>
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
                  {(['curl', 'javascript', 'react', 'nodejs', 'python'] as const).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setSelectedLanguage(lang)}
                      className={`px-3 py-1.5 rounded-lg capitalize font-medium transition ${
                        selectedLanguage === lang
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <button
                  onClick={() => copyToClipboard(getCodeSnippet(), 'code')}
                  className="absolute top-3 right-3 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition z-10 border border-slate-700"
                >
                  {copiedText === 'code' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedText === 'code' ? 'Copied' : 'Copy Code'}
                </button>
                <pre className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl font-mono text-xs text-slate-200 overflow-x-auto leading-relaxed">
                  {getCodeSnippet()}
                </pre>
              </div>
            </div>

            {/* Cloudinary Transformation Cheatsheet */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-base font-semibold text-white mb-3">URL Transformation Syntax Cheatsheet</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <div className="font-mono text-indigo-400 font-semibold mb-1">w_&lt;number&gt; & h_&lt;number&gt;</div>
                  <p className="text-slate-400">Specifies target width and height in pixels (e.g. `w_800,h_600`).</p>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <div className="font-mono text-indigo-400 font-semibold mb-1">c_fill | c_fit | c_thumb</div>
                  <p className="text-slate-400">Cropping strategy: `c_fill` covers area, `c_fit` preserves ratio, `c_thumb` uses AI entropy focus.</p>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <div className="font-mono text-indigo-400 font-semibold mb-1">f_auto | f_webp | f_avif</div>
                  <p className="text-slate-400">Converts format on-the-fly. `f_auto` delivers WebP or AVIF based on browser support.</p>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <div className="font-mono text-indigo-400 font-semibold mb-1">q_&lt;1-100&gt; | q_auto</div>
                  <p className="text-slate-400">Adjusts compression quality. `q_80` reduces payload size by ~70% with zero visible loss.</p>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <div className="font-mono text-indigo-400 font-semibold mb-1">r_max | r_&lt;radius&gt;</div>
                  <p className="text-slate-400">Rounds image corners. `r_max` produces a circular avatar for profiles.</p>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
                  <div className="font-mono text-indigo-400 font-semibold mb-1">e_grayscale | e_blur:&lt;sigma&gt;</div>
                  <p className="text-slate-400">Applies aesthetic image filters and Gaussian blurs.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: MEDIA ASSETS LIBRARY */}
        {activeTab === 'assets' && (() => {
          const imageAssets = mediaAssets.filter(isImageAsset);
          const videoAssets = mediaAssets.filter(isVideoAsset);
          const docAssets = mediaAssets.filter(isPdfAsset);

          const availableFolders = Array.from(
            new Set(
              mediaAssets
                .map((a) => {
                  const parts = a.public_id.split('/');
                  return parts.length > 1 ? parts.slice(0, -1).join('/') : null;
                })
                .filter(Boolean) as string[]
            )
          );

          const filteredAssets = mediaAssets.filter((a) => {
            if (assetTypeFilter === 'image' && !isImageAsset(a)) return false;
            if (assetTypeFilter === 'video' && !isVideoAsset(a)) return false;
            if (assetTypeFilter === 'pdf' && !isPdfAsset(a)) return false;
            if (assetFolderFilter && !a.public_id.toLowerCase().startsWith(`${assetFolderFilter.toLowerCase()}/`)) return false;
            if (assetSearch) {
              const q = assetSearch.toLowerCase();
              return a.public_id.toLowerCase().includes(q) || a.tags?.some((t) => t.toLowerCase().includes(q));
            }
            return true;
          });

          const displayedAssets = filteredAssets.slice(0, visibleCount);

          return (
            <div className="space-y-6">
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Media Assets Library</h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Images, videos, and documents stored programmatically via API keys or saved in your cloud folders.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    {availableFolders.length > 0 && (
                      <select
                        value={assetFolderFilter}
                        onChange={(e) => setAssetFolderFilter(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 font-mono cursor-pointer"
                      >
                        <option value="">All Folders ({availableFolders.length})</option>
                        {availableFolders.map((f) => (
                          <option key={f} value={f}>
                            📁 {f}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      type="text"
                      placeholder="Search by name or tag..."
                      value={assetSearch}
                      onChange={(e) => setAssetSearch(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 w-48 sm:w-56"
                    />
                    <button
                      onClick={loadData}
                      className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                      title="Refresh library"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 scrollbar-none">
                  <button
                    onClick={() => setAssetTypeFilter('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      assetTypeFilter === 'all'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    <span>All Media</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-950/60 font-mono">
                      {mediaAssets.length}
                    </span>
                  </button>
                  <button
                    onClick={() => setAssetTypeFilter('image')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      assetTypeFilter === 'image'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>Images</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-950/60 font-mono">
                      {imageAssets.length}
                    </span>
                  </button>
                  <button
                    onClick={() => setAssetTypeFilter('video')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      assetTypeFilter === 'video'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Videos</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-950/60 font-mono">
                      {videoAssets.length}
                    </span>
                  </button>
                  <button
                    onClick={() => setAssetTypeFilter('pdf')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      assetTypeFilter === 'pdf'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Documents & PDFs</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-950/60 font-mono">
                      {docAssets.length}
                    </span>
                  </button>
                </div>

                {filteredAssets.length === 0 ? (
                  <div className="text-center py-16 border border-dashed border-slate-800 rounded-2xl">
                    <ImageIcon className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <h3 className="text-base font-semibold text-white">No Matching Media Found</h3>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
                      {assetSearch || assetFolderFilter || assetTypeFilter !== 'all'
                        ? 'Try clearing your search filters or selecting another category.'
                        : 'Upload assets using the API Test Dropzone or via your application API keys.'}
                    </p>
                    {assetSearch || assetFolderFilter || assetTypeFilter !== 'all' ? (
                      <button
                        onClick={() => {
                          setAssetSearch('');
                          setAssetFolderFilter('');
                          setAssetTypeFilter('all');
                        }}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl"
                      >
                        Reset All Filters
                      </button>
                    ) : (
                      <button
                        onClick={() => setActiveTab('upload')}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2"
                      >
                        <UploadCloud className="w-4 h-4" />
                        Go to API Test Dropzone
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {displayedAssets.map((asset) => {
                        const isDoc = isPdfAsset(asset);
                        const isVid = isVideoAsset(asset);
                        const isImg = isImageAsset(asset);

                        return (
                          <div
                            key={asset.asset_id}
                            className="group bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-xl overflow-hidden flex flex-col transition-all shadow-md hover:shadow-indigo-500/10"
                          >
                            <div
                              onClick={() => setActiveModalAsset(asset)}
                              className="relative aspect-square bg-slate-950/80 flex items-center justify-center overflow-hidden cursor-pointer"
                            >
                              {isDoc ? (
                                <div className="flex flex-col items-center justify-center p-3 text-center w-full h-full select-none">
                                  <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                                    <FileText className="w-6 h-6 text-rose-400" />
                                  </div>
                                  <span className="text-[11px] font-medium text-slate-200 line-clamp-2 px-2 text-center break-all">
                                    {asset.public_id.split('/').pop()}
                                  </span>
                                  <span className="text-[10px] text-rose-400 font-semibold mt-1">
                                    PDF Document
                                  </span>
                                </div>
                              ) : isVid ? (
                                <div className="flex flex-col items-center justify-center p-3 text-center w-full h-full select-none">
                                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                                    <Play className="w-6 h-6 text-indigo-400 fill-indigo-400/20" />
                                  </div>
                                  <span className="text-[11px] font-medium text-slate-200 line-clamp-2 px-2 text-center break-all">
                                    {asset.public_id.split('/').pop()}
                                  </span>
                                  <span className="text-[10px] text-indigo-400 font-semibold mt-1 uppercase">
                                    {asset.format} Video
                                  </span>
                                </div>
                              ) : isImg && !imgErrors[asset.asset_id] ? (
                                <img
                                  src={resolveAssetUrl(asset.thumbnail_url || asset.url, asset.public_id)}
                                  alt={asset.public_id}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  loading="lazy"
                                  onError={() => setImgErrors((prev) => ({ ...prev, [asset.asset_id]: true }))}
                                />
                              ) : (
                                <div className="flex flex-col items-center justify-center p-3 text-center w-full h-full">
                                  <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-2">
                                    <ImageIcon className="w-6 h-6 text-slate-400" />
                                  </div>
                                  <span className="text-[11px] font-medium text-slate-300 truncate max-w-[120px]">
                                    {asset.public_id.split('/').pop()}
                                  </span>
                                  <span className="text-[10px] text-slate-500 mt-1 uppercase">
                                    {asset.format}
                                  </span>
                                </div>
                              )}

                              <span
                                className={`absolute top-2 right-2 px-2 py-0.5 backdrop-blur rounded text-[10px] font-mono border uppercase ${
                                  isDoc
                                    ? 'bg-rose-950/80 text-rose-300 border-rose-700/60'
                                    : isVid
                                    ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60'
                                    : 'bg-slate-950/80 text-indigo-300 border-slate-700/60'
                                }`}
                              >
                                {asset.format}
                              </span>

                              {/* Hover overlay */}
                              <div className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <span className="px-2.5 py-1 bg-indigo-600/90 text-white rounded-lg text-[11px] font-medium flex items-center gap-1 shadow-lg">
                                  <Eye className="w-3 h-3" />
                                  Open
                                </span>
                              </div>
                            </div>

                            <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                              <div>
                                <div
                                  onClick={() => setActiveModalAsset(asset)}
                                  className="text-xs font-mono font-medium text-white truncate cursor-pointer hover:text-indigo-400 transition"
                                  title={asset.public_id}
                                >
                                  {asset.public_id}
                                </div>
                                <div className="text-[11px] text-slate-400 flex items-center justify-between mt-1">
                                  <span>{formatBytes(asset.bytes)}</span>
                                  {asset.width && asset.height && (
                                    <span className="font-mono text-slate-500">
                                      {asset.width}x{asset.height}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                                {isImg ? (
                                  <button
                                    onClick={() => {
                                      setSelectedImage(asset.public_id);
                                      setActiveTab('playground');
                                    }}
                                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                                  >
                                    Transform
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => setActiveModalAsset(asset)}
                                    className="text-[11px] text-slate-400 hover:text-slate-200 font-medium cursor-pointer"
                                  >
                                    Preview
                                  </button>
                                )}

                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() =>
                                      copyToClipboard(
                                        resolveAssetUrl(asset.secure_url || asset.url, asset.public_id),
                                        `url_${asset.asset_id}`
                                      )
                                    }
                                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition cursor-pointer"
                                    title="Copy direct secure URL"
                                  >
                                    {copiedText === `url_${asset.asset_id}` ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteAsset(asset.public_id)}
                                    className="p-1 hover:bg-rose-500/20 rounded text-slate-400 hover:text-rose-400 transition cursor-pointer"
                                    title="Delete media asset"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {filteredAssets.length > visibleCount && (
                      <div className="mt-8 text-center">
                        <button
                          onClick={() => setVisibleCount((prev) => prev + 48)}
                          className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition cursor-pointer shadow-sm"
                        >
                          Load More Media ({filteredAssets.length - visibleCount} remaining)
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* TAB 5: API TEST DROPZONE */}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="max-w-2xl mx-auto space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-white">API Test Upload Dropzone</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Test the programmatic upload pipeline directly from your browser to verify pooling, metadata extraction, and response payloads.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Destination Folder (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. blog, avatars, products"
                      value={uploadFolder}
                      onChange={(e) => setUploadFolder(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. hero, summer, banner"
                      value={uploadTags}
                      onChange={(e) => setUploadTags(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>

                {/* Dropzone */}
                <label className="border-2 border-dashed border-slate-700 hover:border-indigo-500/80 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer bg-slate-900/40 hover:bg-slate-900/80 transition group">
                  <UploadCloud className="w-12 h-12 text-slate-500 group-hover:text-indigo-400 group-hover:scale-110 transition-all mb-3" />
                  <span className="text-sm font-semibold text-white">
                    {isUploading ? 'Uploading & Processing Media...' : 'Click or Drag & Drop Media to Test Upload'}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">
                    Supports Images (JPG, PNG, WebP, AVIF, GIF) and Videos (MP4, MOV, WebM) up to 500MB
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleTestUpload}
                    disabled={isUploading}
                  />
                </label>

                {uploadStatus && (
                  <div className="flex items-center gap-2 text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 p-3 rounded-xl">
                    <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                    <span>{uploadStatus}</span>
                  </div>
                )}

                {uploadResponseJson && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>myDrive API Response:</span>
                      <button
                        onClick={() => copyToClipboard(uploadResponseJson, 'json')}
                        className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
                      >
                        {copiedText === 'json' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        Copy JSON
                      </button>
                    </div>
                    <pre className="bg-slate-900 border border-slate-800 p-4 rounded-xl font-mono text-xs text-emerald-400 overflow-x-auto leading-relaxed">
                      {uploadResponseJson}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: Create Key Prompt */}
      {isNewKeyModalOpen && !createdSecretData && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-indigo-400" />
              Generate New Developer API Key
            </h3>
            <p className="text-xs text-slate-400">
              Provide a descriptive label for where this key will be used (e.g. Next.js Portfolio, Shopify Store, Mobile App).
            </p>

            <form onSubmit={handleCreateKey} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Key Label / Application Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Next.js Blog Production"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewKeyModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow transition cursor-pointer"
                >
                  Generate Credentials
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: New Key Secret Display (Shown only ONCE!) */}
      {createdSecretData && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-amber-500/30 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Save Your API Secret Now</h3>
                <p className="text-xs text-amber-300/80">
                  For your security, this API Secret will never be displayed again.
                </p>
              </div>
            </div>

            <div className="space-y-3 bg-slate-900/90 border border-slate-800 p-4 rounded-xl text-xs font-mono">
              <div>
                <span className="text-slate-500 block mb-0.5">API Key (Public):</span>
                <span className="text-white select-all">{createdSecretData.apiKey}</span>
              </div>
              <div className="pt-2 border-t border-slate-800">
                <span className="text-slate-500 block mb-0.5">API Secret (Private):</span>
                <span className="text-emerald-400 select-all font-semibold">{createdSecretData.apiSecret}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() =>
                  copyToClipboard(
                    `MYDRIVE_MEDIA_KEY=${createdSecretData.apiKey}\nMYDRIVE_MEDIA_SECRET=${createdSecretData.apiSecret}\nMYDRIVE_MEDIA_URL=${apiBase}/media\n# Drop-in Cloudinary SDK compatibility:\nCLOUDINARY_CLOUD_NAME=${cloudName}\nCLOUDINARY_API_KEY=${createdSecretData.apiKey}\nCLOUDINARY_API_SECRET=${createdSecretData.apiSecret}`,
                    'full_secret'
                  )
                }
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                {copiedText === 'full_secret' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                Copy Credentials (.env)
              </button>

              <button
                onClick={() => {
                  setCreatedSecretData(null);
                  setIsNewKeyModalOpen(false);
                }}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow transition cursor-pointer"
              >
                Done & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Edit Cloud Name */}
      {isCloudNameModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Customize Cloud Name</h3>
            <p className="text-xs text-slate-400">
              Your cloud name is your public namespace identifier for media asset delivery URLs.
            </p>

            <form onSubmit={handleUpdateCloudName} className="space-y-4">
              <div>
                <input
                  type="text"
                  required
                  placeholder="e.g. karankumar"
                  value={editCloudNameInput}
                  onChange={(e) => setEditCloudNameInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCloudNameModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Media Preview Lightbox Modal */}
      {activeModalAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
          onClick={() => setActiveModalAsset(null)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div className="flex items-center gap-3 overflow-hidden">
                <div
                  className={`p-2 rounded-xl border ${
                    isPdfAsset(activeModalAsset)
                      ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                      : isVideoAsset(activeModalAsset)
                      ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  }`}
                >
                  {isPdfAsset(activeModalAsset) ? (
                    <FileText className="w-5 h-5" />
                  ) : isVideoAsset(activeModalAsset) ? (
                    <Play className="w-5 h-5" />
                  ) : (
                    <ImageIcon className="w-5 h-5" />
                  )}
                </div>
                <div className="overflow-hidden">
                  <h3 className="text-sm font-semibold text-white truncate" title={activeModalAsset.public_id}>
                    {activeModalAsset.public_id}
                  </h3>
                  <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                    <span className="font-mono uppercase">{activeModalAsset.format}</span>
                    <span>•</span>
                    <span>{formatBytes(activeModalAsset.bytes)}</span>
                    {activeModalAsset.width && activeModalAsset.height && (
                      <>
                        <span>•</span>
                        <span>
                          {activeModalAsset.width} × {activeModalAsset.height} px
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={resolveAssetUrl(activeModalAsset.url, activeModalAsset.public_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                  title="Open in new window"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setActiveModalAsset(null)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                  title="Close viewer (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Main Content */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center bg-slate-950/40 min-h-[360px]">
              {isPdfAsset(activeModalAsset) ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-slate-900/80 border border-slate-800 rounded-2xl text-center">
                  <div className="w-20 h-20 rounded-3xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4">
                    <FileText className="w-10 h-10 text-rose-400" />
                  </div>
                  <h4 className="text-base font-semibold text-white mb-1">PDF Document</h4>
                  <p className="text-xs text-slate-400 max-w-md mb-6 break-all font-mono">
                    {activeModalAsset.public_id}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <a
                      href={resolveAssetUrl(activeModalAsset.url, activeModalAsset.public_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition cursor-pointer"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open PDF in New Window
                    </a>
                    <a
                      href={resolveAssetUrl(activeModalAsset.url, activeModalAsset.public_id)}
                      download
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl inline-flex items-center gap-2 border border-slate-700 transition cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      Download PDF
                    </a>
                  </div>
                </div>
              ) : isVideoAsset(activeModalAsset) ? (
                <div className="w-full flex items-center justify-center">
                  <video
                    src={resolveAssetUrl(activeModalAsset.url, activeModalAsset.public_id)}
                    controls
                    autoPlay
                    className="max-h-[60vh] max-w-full rounded-xl shadow-2xl border border-slate-800"
                  />
                </div>
              ) : isImageAsset(activeModalAsset) ? (
                <div className="w-full flex items-center justify-center">
                  <img
                    src={resolveAssetUrl(activeModalAsset.url, activeModalAsset.public_id)}
                    alt={activeModalAsset.public_id}
                    className="max-h-[60vh] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800"
                  />
                </div>
              ) : (
                <div className="text-center p-8">
                  <p className="text-slate-400 text-sm">Preview not supported for this file format.</p>
                  <a
                    href={resolveAssetUrl(activeModalAsset.url, activeModalAsset.public_id)}
                    download
                    className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" /> Download File
                  </a>
                </div>
              )}
            </div>

            {/* Modal Footer with URL & Quick Actions */}
            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-slate-400 mb-1 flex items-center gap-2">
                  <span>Direct Delivery URL:</span>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        resolveAssetUrl(activeModalAsset.secure_url || activeModalAsset.url, activeModalAsset.public_id),
                        'modal_url'
                      )
                    }
                    className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 text-[11px] cursor-pointer"
                  >
                    {copiedText === 'modal_url' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedText === 'modal_url' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="font-mono text-xs text-emerald-400 truncate bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 select-all">
                  {resolveAssetUrl(activeModalAsset.secure_url || activeModalAsset.url, activeModalAsset.public_id)}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                {isImageAsset(activeModalAsset) && (
                  <button
                    onClick={() => {
                      setSelectedImage(activeModalAsset.public_id);
                      setActiveTab('playground');
                      setActiveModalAsset(null);
                    }}
                    className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    Transform in Studio
                  </button>
                )}
                <button
                  onClick={() => {
                    handleDeleteAsset(activeModalAsset.public_id);
                    setActiveModalAsset(null);
                  }}
                  className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
