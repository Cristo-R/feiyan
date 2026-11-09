const PET_ASSET_BASE_URL = (
  process.env.NEXT_PUBLIC_PET_ASSET_BASE_URL
  || 'https://zhybkt.oss-cn-hongkong.aliyuncs.com/feiyan/site-pet/20261109-1'
).replace(/\/$/, '');
const PET_ASSET_VERSION = process.env.NEXT_PUBLIC_PET_ASSET_VERSION || '20261109-1';

export function petAssetUrl(path: string) {
  return `${PET_ASSET_BASE_URL}/${path.replace(/^\//, '')}?v=${encodeURIComponent(PET_ASSET_VERSION)}`;
}
