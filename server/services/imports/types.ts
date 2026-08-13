export type ImportSourceType = 'sleekplan' | 'csv'
export type ImportSourceMode = 'api' | 'file'
export type ImportRunStatus = 'draft' | 'analyzing' | 'ready' | 'importing' | 'completed' | 'failed' | 'canceled'
export type DuplicatePolicy = 'skip_existing' | 'update_existing'
export type ImportedSourceKind = 'feedback' | 'roadmap'
export type ImportIssueSeverity = 'warning' | 'error' | 'skipped'

export interface CanonicalCategoryRecord {
  externalId: string
  name: string
  slug?: string | null
  color?: string | null
  description?: string | null
}

export interface CanonicalStatusRecord {
  externalId: string
  name: string
  value?: string | null
  color?: string | null
  description?: string | null
  sortOrder?: number | null
}

export interface CanonicalFeedbackRecord {
  externalId: string
  title: string
  body?: string | null
  status?: string | null
  category?: string | null
  authorName?: string | null
  authorEmail?: string | null
  voteCount?: number | null
  commentCount?: number | null
  createdAt?: string | null
  updatedAt?: string | null
  sourceKind?: ImportedSourceKind | null
  metadata?: Record<string, any> | null
}

export interface CanonicalCommentRecord {
  externalId: string
  feedbackExternalId: string
  body: string
  authorName?: string | null
  authorEmail?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  isInternal?: boolean | null
  metadata?: Record<string, any> | null
}

export interface CanonicalSubscriptionRecord {
  externalId: string
  feedbackExternalId: string
  email: string
  notifyChannel?: 'email' | 'app' | 'both' | null
  metadata?: Record<string, any> | null
}

export interface CanonicalChangelogRecord {
  externalId: string
  title: string
  body: string
  category?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  publishedAt?: string | null
  metadata?: Record<string, any> | null
}

export interface CanonicalImportIssue {
  severity: ImportIssueSeverity
  entityType: string
  externalId?: string | null
  message: string
  details?: Record<string, any> | null
}

export interface CanonicalImportSnapshot {
  sourceType: ImportSourceType
  sourceMode: ImportSourceMode
  categories: CanonicalCategoryRecord[]
  statuses: CanonicalStatusRecord[]
  feedback: CanonicalFeedbackRecord[]
  roadmapEntries: CanonicalFeedbackRecord[]
  changelogEntries: CanonicalChangelogRecord[]
  comments: CanonicalCommentRecord[]
  subscriptions: CanonicalSubscriptionRecord[]
  warnings: CanonicalImportIssue[]
}

export interface ImportContentScope {
  feedback: boolean
  roadmap: boolean
  changelog: boolean
  comments: boolean
  subscriptions: boolean
}

export interface ImportAnalysisSummary {
  counts: {
    categories: number
    statuses: number
    feedback: number
    roadmapEntries: number
    changelogEntries: number
    comments: number
    subscriptions: number
  }
  duplicates: {
    feedback: number
    changelog: number
  }
  warnings: number
}

export interface CategoryMapping {
  sourceKey: string
  sourceName: string
  mode: 'existing' | 'create'
  targetId?: string
  targetName: string
}

export interface StatusMapping {
  sourceKey: string
  sourceName: string
  mode: 'system' | 'existing' | 'create'
  targetValue: string
  targetName: string
}

export interface ImportMappingConfig {
  duplicatePolicy: DuplicatePolicy
  contentScope: ImportContentScope
  categoryMappings: Record<string, CategoryMapping>
  statusMappings: Record<string, StatusMapping>
}

export interface ImportAnalysisResult {
  snapshot: CanonicalImportSnapshot
  summary: ImportAnalysisSummary
  mappingConfig: ImportMappingConfig
  issues: CanonicalImportIssue[]
}

export interface CsvFileEntry {
  content: string
  filename?: string | null
}

export interface AnalyzeImportInput {
  sourceType: ImportSourceType
  sourceMode?: ImportSourceMode
  csvContent?: string
  csvFilename?: string | null
  csvFiles?: CsvFileEntry[]
  sleekplan?: {
    baseUrl: string
    apiKey: string
  }
  contentScope?: Partial<ImportContentScope>
}
