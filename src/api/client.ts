import { request } from '../core/index.js';
import type {
  AddKeywordsRequest,
  AlertSettings,
  AnalyzeWebsiteRequest,
  AnalyzeWebsiteResponse,
  CountMentionsQuery,
  CreateWebsiteRequest,
  DeletedResponse,
  EditKeywordRequest,
  Keyword,
  KeywordBillingPreview,
  KeywordBillingPreviewQuery,
  ListMentionsQuery,
  MeanMarketerConfig,
  MeanMarketerPollResult,
  MeanMarketerResetResponse,
  Mention,
  MentionCountResponse,
  MentionListResponse,
  QuotaUsage,
  UpdateAlertSettingsRequest,
  UpdateMeanMarketerConfigRequest,
  UpdateMentionStatusRequest,
  UpdateWebsiteRequest,
  Website,
  WebsiteListResponse,
} from './types.js';

const segment = (value: string): string => encodeURIComponent(value);

export const listWebsites = (): Promise<WebsiteListResponse> =>
  request<WebsiteListResponse>({ method: 'GET', path: '/websites' });

export const getWebsite = (websiteId: string): Promise<Website> =>
  request<Website>({ method: 'GET', path: `/websites/${segment(websiteId)}` });

export const createWebsite = (
  createWebsiteRequest: CreateWebsiteRequest,
): Promise<Website> =>
  request<Website>({
    method: 'POST',
    path: '/websites',
    body: createWebsiteRequest,
  });

export const updateWebsite = (
  websiteId: string,
  updateWebsiteRequest: UpdateWebsiteRequest,
): Promise<Website> =>
  request<Website>({
    method: 'PATCH',
    path: `/websites/${segment(websiteId)}`,
    body: updateWebsiteRequest,
  });

export const deleteWebsite = (websiteId: string): Promise<DeletedResponse> =>
  request<DeletedResponse>({
    method: 'DELETE',
    path: `/websites/${segment(websiteId)}`,
  });

export const analyzeWebsiteDescription = (
  analyzeWebsiteRequest: AnalyzeWebsiteRequest,
): Promise<AnalyzeWebsiteResponse> =>
  request<AnalyzeWebsiteResponse>({
    method: 'POST',
    path: '/websites/analyze-description',
    body: analyzeWebsiteRequest,
  });

export const addKeywords = (
  websiteId: string,
  addKeywordsRequest: AddKeywordsRequest,
): Promise<Website> =>
  request<Website>({
    method: 'POST',
    path: `/websites/${segment(websiteId)}/keywords`,
    body: addKeywordsRequest,
  });

export const editKeyword = (
  keywordId: string,
  editKeywordRequest: EditKeywordRequest,
): Promise<Keyword> =>
  request<Keyword>({
    method: 'PATCH',
    path: `/keywords/${segment(keywordId)}`,
    body: editKeywordRequest,
  });

export const disableKeyword = (keywordId: string): Promise<Keyword> =>
  request<Keyword>({
    method: 'POST',
    path: `/keywords/${segment(keywordId)}/disable`,
    idempotent: true,
  });

export const enableKeyword = (keywordId: string): Promise<Keyword> =>
  request<Keyword>({
    method: 'POST',
    path: `/keywords/${segment(keywordId)}/enable`,
    idempotent: true,
  });

export const deleteKeyword = (keywordId: string): Promise<DeletedResponse> =>
  request<DeletedResponse>({
    method: 'DELETE',
    path: `/keywords/${segment(keywordId)}`,
  });

export const activatePendingKeywords = (): Promise<WebsiteListResponse> =>
  request<WebsiteListResponse>({
    method: 'POST',
    path: '/keywords/activate-pending',
    idempotent: true,
  });

export const previewActivatePendingKeywords =
  (): Promise<KeywordBillingPreview> =>
    request<KeywordBillingPreview>({
      method: 'GET',
      path: '/keywords/activate-pending/preview',
    });

export const previewKeywordBilling = (
  keywordBillingPreviewQuery: KeywordBillingPreviewQuery,
): Promise<KeywordBillingPreview> =>
  request<KeywordBillingPreview>({
    method: 'GET',
    path: '/keywords/billing-preview',
    query: keywordBillingPreviewQuery,
  });

export const getKeywordChangeUsage = (): Promise<QuotaUsage> =>
  request<QuotaUsage>({ method: 'GET', path: '/keywords/change-usage' });

export const listMentions = (
  listMentionsQuery: ListMentionsQuery = {},
): Promise<MentionListResponse> =>
  request<MentionListResponse>({
    method: 'GET',
    path: '/mentions',
    query: listMentionsQuery,
  });

export const countMentions = (
  countMentionsQuery: CountMentionsQuery = {},
): Promise<MentionCountResponse> =>
  request<MentionCountResponse>({
    method: 'GET',
    path: '/mentions/count',
    query: countMentionsQuery,
  });

export const updateMentionStatus = (
  mentionId: string,
  updateMentionStatusRequest: UpdateMentionStatusRequest,
): Promise<Mention> =>
  request<Mention>({
    method: 'PATCH',
    path: `/mentions/${segment(mentionId)}/status`,
    body: updateMentionStatusRequest,
  });

export const explainMention = (mentionId: string): Promise<Mention | null> =>
  request<Mention | null>({
    method: 'POST',
    path: `/mentions/${segment(mentionId)}/explain`,
    idempotent: true,
  });

export const getAlertSettings = (): Promise<AlertSettings> =>
  request<AlertSettings>({ method: 'GET', path: '/alert-settings' });

export const updateAlertSettings = (
  updateAlertSettingsRequest: UpdateAlertSettingsRequest,
): Promise<AlertSettings> =>
  request<AlertSettings>({
    method: 'PUT',
    path: '/alert-settings',
    body: updateAlertSettingsRequest,
  });

export const getMeanMarketerConfig = (): Promise<MeanMarketerConfig> =>
  request<MeanMarketerConfig>({
    method: 'GET',
    path: '/mean-marketer/config',
  });

export const updateMeanMarketerConfig = (
  updateMeanMarketerConfigRequest: UpdateMeanMarketerConfigRequest,
): Promise<MeanMarketerConfig> =>
  request<MeanMarketerConfig>({
    method: 'PUT',
    path: '/mean-marketer/config',
    body: updateMeanMarketerConfigRequest,
  });

export const pollMeanMarketer = (): Promise<MeanMarketerPollResult> =>
  request<MeanMarketerPollResult>({
    method: 'POST',
    path: '/mean-marketer/poll',
  });

export const resetMeanMarketer = (): Promise<MeanMarketerResetResponse> =>
  request<MeanMarketerResetResponse>({
    method: 'POST',
    path: '/mean-marketer/reset',
    idempotent: true,
  });
