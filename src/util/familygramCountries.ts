import type { ApiCountryCode } from '../api/types';

/** Fallback phone countries when the server list is not loaded yet (self-hosted). */
export const FAMILYGRAM_FALLBACK_PHONE_CODES: ApiCountryCode[] = [
  { iso2: 'US', defaultName: 'USA', countryCode: '1' },
  { iso2: 'PH', defaultName: 'Philippines', countryCode: '63' },
  { iso2: 'GB', defaultName: 'United Kingdom', countryCode: '44' },
  { iso2: 'DE', defaultName: 'Germany', countryCode: '49' },
  { iso2: 'FR', defaultName: 'France', countryCode: '33' },
  { iso2: 'IN', defaultName: 'India', countryCode: '91' },
  { iso2: 'AU', defaultName: 'Australia', countryCode: '61' },
  { iso2: 'CA', defaultName: 'Canada', countryCode: '1' },
  { iso2: 'SG', defaultName: 'Singapore', countryCode: '65' },
  { iso2: 'MY', defaultName: 'Malaysia', countryCode: '60' },
  { iso2: 'ID', defaultName: 'Indonesia', countryCode: '62' },
  { iso2: 'TH', defaultName: 'Thailand', countryCode: '66' },
  { iso2: 'VN', defaultName: 'Vietnam', countryCode: '84' },
  { iso2: 'JP', defaultName: 'Japan', countryCode: '81' },
  { iso2: 'KR', defaultName: 'South Korea', countryCode: '82' },
  { iso2: 'CN', defaultName: 'China', countryCode: '86' },
  { iso2: 'RU', defaultName: 'Russia', countryCode: '7' },
  { iso2: 'UA', defaultName: 'Ukraine', countryCode: '380' },
  { iso2: 'PL', defaultName: 'Poland', countryCode: '48' },
  { iso2: 'NL', defaultName: 'Netherlands', countryCode: '31' },
  { iso2: 'IT', defaultName: 'Italy', countryCode: '39' },
  { iso2: 'ES', defaultName: 'Spain', countryCode: '34' },
  { iso2: 'BR', defaultName: 'Brazil', countryCode: '55' },
  { iso2: 'MX', defaultName: 'Mexico', countryCode: '52' },
  { iso2: 'AE', defaultName: 'United Arab Emirates', countryCode: '971' },
  { iso2: 'SA', defaultName: 'Saudi Arabia', countryCode: '966' },
  { iso2: 'TR', defaultName: 'Turkey', countryCode: '90' },
  { iso2: 'ZA', defaultName: 'South Africa', countryCode: '27' },
  { iso2: 'NZ', defaultName: 'New Zealand', countryCode: '64' },
];

export const FAMILYGRAM_DEFAULT_COUNTRY_ISO = 'US';

export function getFamilyGramFallbackCountryList() {
  return {
    phoneCodes: FAMILYGRAM_FALLBACK_PHONE_CODES,
    general: FAMILYGRAM_FALLBACK_PHONE_CODES,
  };
}