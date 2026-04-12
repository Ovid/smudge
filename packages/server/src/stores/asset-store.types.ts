export type AssetKind = "pdf" | "docx" | "image" | "web-link" | "note";
export type AssetStorageMode = "linked" | "managed";

export interface AssetRow {
  id: string;
  project_id: string;
  kind: AssetKind;
  storage_mode: AssetStorageMode;
  path_or_uri: string;
  title: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateAssetRow {
  id: string;
  project_id: string;
  kind: AssetKind;
  storage_mode: AssetStorageMode;
  path_or_uri: string;
  title: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface AssetStore {
  insertAsset(data: CreateAssetRow): Promise<AssetRow>;
  findAssetById(id: string): Promise<AssetRow | null>;
  listAssetsByProject(projectId: string): Promise<AssetRow[]>;
  softDeleteAsset(id: string, now: string): Promise<void>;
}
