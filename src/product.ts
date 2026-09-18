export const PRODUCT = {
  id: 'redreplier',
  displayName: 'RedReplier',
  binName: 'redreplier',
  altBinName: 'rr',
  npmPackage: '@redreplier/cli',
  envPrefix: 'REDREPLIER',
  defaultApiUrl: 'https://ai.redreplier.com/ai-app/api/v1',
  appUrl: 'https://redreplier.com',
  tokensUrl: 'https://redreplier.com/api-tokens',
  tokenPrefixes: ['redreplier_'],
  verifyPath: '/websites',
} as const;
