export const MENTION_SOURCES = [
  'REDDIT_POST',
  'REDDIT_COMMENT',
  'TWITTER',
  'BLUESKY',
  'HACKERNEWS',
  'FACEBOOK',
  'FACEBOOK_GROUP',
] as const;
export type MentionSource = (typeof MENTION_SOURCES)[number];

export const MENTION_STATUSES = ['NEW', 'APPROVED', 'REJECTED'] as const;
export type MentionStatus = (typeof MENTION_STATUSES)[number];

export const RELEVANCE_BUCKETS = [
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
] as const;
export type RelevanceBucket = (typeof RELEVANCE_BUCKETS)[number];

export const MENTION_SORTS = ['RELEVANCE', 'RECENT'] as const;
export type MentionSort = (typeof MENTION_SORTS)[number];

export const KEYWORD_STATUSES = [
  'PENDING',
  'ACTIVE',
  'DISABLED',
  'SUSPENDED',
] as const;
export type KeywordStatus = (typeof KEYWORD_STATUSES)[number];

export const ALERT_CADENCES = [15, 30, 60, 120, 180, 240, 720, 1440] as const;
export type AlertCadence = (typeof ALERT_CADENCES)[number];

export const MAX_KEYWORD_LENGTH = 255;

export const MAX_WEBSITE_DESCRIPTION_LENGTH = 5000;

export const MENTION_LIMIT_MIN = 1;

export const MENTION_LIMIT_MAX = 500;

export const MEAN_MARKETER_MIN_SCORE = 50;

export const MEAN_MARKETER_MAX_SCORE = 100;

export interface OffsetPagination {
  total: number;
  limit: number;
  offset: number;
}

export interface DeletedResponse {
  deleted: boolean;
}

export interface Keyword {
  id: string;
  websiteId: string;
  value: string;
  status: KeywordStatus;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Website {
  id: string;
  accountGroupId: string;
  domain: string;
  url: string;
  name: string | null;
  description: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  keywords: Keyword[];
}

export interface WebsiteListResponse {
  websites: Website[];
}

export interface CreateWebsiteRequest {
  url: string;
  name?: string;
  keywords?: string[];
  description?: string;
}

export interface UpdateWebsiteRequest {
  name?: string;
  description?: string;
}

export interface AnalyzeWebsiteRequest {
  url: string;
}

export interface AnalyzeWebsiteResponse {
  description: string;
}

export interface AddKeywordsRequest {
  keywords: string[];
}

export interface EditKeywordRequest {
  value: string;
}

export interface KeywordBillingPreview {
  currentPlanName: string | null;
  currentMonthlyPrice: number;
  targetPlanName: string | null;
  targetMonthlyPrice: number;
  targetKeywords: number;
  immediateCharge: number;
  isUpgrade: boolean;
  isDowngrade: boolean;
  requiresImmediatePayment: boolean;
}

export type KeywordBillingPreviewQuery = {
  desiredKeywordCount: number;
};

export interface QuotaUsage {
  limit: number;
  used: number;
  remaining: number;
  unlimited: boolean;
}

export interface Mention {
  id: string;
  websiteId: string;
  source: MentionSource;
  keyword: string | null;
  title: string | null;
  contentText: string | null;
  url: string;
  author: string | null;
  subreddit: string | null;
  status: MentionStatus;
  relevanceScore: number | null;
  relevanceReason: string | null;
  aiReplySuggestion: string | null;
  tags: string[];
  publishedAt: string | null;
  ingestedAt: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MentionListResponse extends OffsetPagination {
  mentions: Mention[];
}

export interface MentionCountResponse {
  total: number;
}

export type MentionFilterQuery = {
  websiteId?: string;
  statuses?: MentionStatus[];
  scoreBuckets?: RelevanceBucket[];
  includeLowRelevance?: boolean;
  keywords?: string[];
  sources?: MentionSource[];
  from?: string;
  to?: string;
};

export type ListMentionsQuery = MentionFilterQuery & {
  sort?: MentionSort;
  limit?: number;
  offset?: number;
};

export type CountMentionsQuery = MentionFilterQuery;

export interface UpdateMentionStatusRequest {
  status: MentionStatus;
}

export interface AlertSettings {
  enabled: boolean;
  cadenceMinutes: number;
  minIntervalMinutes: number;
  availableCadences: number[];
}

export interface UpdateAlertSettingsRequest {
  enabled: boolean;
  cadenceMinutes?: number;
}

export interface MeanMarketerConfig {
  enabled: boolean;
  minScore: number;
  websiteId: string | null;
  profanity: boolean;
}

export interface UpdateMeanMarketerConfigRequest {
  enabled?: boolean;
  minScore?: number;
  websiteId?: string | null;
  profanity?: boolean;
}

export interface MeanMarketerOpportunity {
  id: string;
  websiteId: string;
  title: string | null;
  url: string | null;
  source: string;
  subreddit: string | null;
  keyword: string | null;
  relevanceScore: number | null;
  relevanceReason: string | null;
}

export interface MeanMarketerPrevious {
  id: string;
  status: MentionStatus | 'GONE';
  triaged: boolean;
  hoursOutstanding: number;
}

export interface MeanMarketerPollResult {
  enabled: boolean;
  minScore: number;
  beMean: boolean;
  tier: number;
  strikes: number;
  previous: MeanMarketerPrevious | null;
  opportunity: MeanMarketerOpportunity | null;
  noNewOpportunity: boolean;
  message: string | null;
}

export interface MeanMarketerResetResponse {
  reset: boolean;
}
