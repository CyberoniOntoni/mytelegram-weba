import {
  memo, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiCountryCode } from '../../api/types';
import type { GlobalState } from '../../global/types';

import { IS_FAMILYGRAM } from '../../config';
import {
  FAMILYGRAM_DEFAULT_COUNTRY_ISO,
  FAMILYGRAM_FALLBACK_PHONE_CODES,
} from '../../util/familygramCountries';
import {
  getFamilyGramWebSocketUrl,
  probeFamilyGramWebSocket,
  type FamilyGramWsProbeResult,
} from '../../util/familygramConnectionProbe';
import { requestMeasure } from '../../lib/fasterdom/fasterdom';
import { IS_SAFARI, IS_TOUCH_ENV } from '../../util/browser/windowEnvironment';
import { preloadImage } from '../../util/files';
import preloadFonts from '../../util/fonts';
import { getAccountSlotUrl } from '../../util/multiaccount';
import { oldSetLanguage } from '../../util/oldLangProvider';
import { formatPhoneNumber, getCountryCodeByIso, getCountryFromPhoneNumber } from '../../util/phoneNumber';
import { navigateBack } from './helpers/backNavigation';
import { getSuggestedLanguage } from './helpers/getSuggestedLanguage';

import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLangString from '../../hooks/useLangString';
import useLastCallback from '../../hooks/useLastCallback';
import useMultiaccountInfo from '../../hooks/useMultiaccountInfo';

import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import InputText from '../ui/InputText';
import Loading from '../ui/Loading';
import CountryCodeInput from './CountryCodeInput';

import monkeyPath from '../../assets/monkey.svg';

type StateProps = {
  auth: GlobalState['auth'];
  connectionState: GlobalState['connectionState'];
  language?: string;
  phoneCodeList: ApiCountryCode[];
  isTestServer?: boolean;
};

const MIN_NUMBER_LENGTH = 7;

let isPreloadInitiated = false;

const AuthPhoneNumber = ({
  auth,
  connectionState,
  phoneCodeList,
  language,
  isTestServer,
}: StateProps) => {
  const {
    setAuthPhoneNumber,
    setAuthRememberMe,
    loadNearestCountry,
    loadCountryList,
    clearAuthErrorKey,
    goToAuthQrCode,
    setSharedSettingOption,
    loginWithPasskey,
    destroyConnection,
    initApi,
  } = getActions();

  const {
    state,
    phoneNumber: authPhoneNumber,
    nearestCountry,
    isLoading: authIsLoading,
    errorKey,
    rememberMe,
    isLoadingQrCode,
    passkeyOption,
  } = auth;

  const lang = useLang();
  const inputRef = useRef<HTMLInputElement>();
  const suggestedLanguage = getSuggestedLanguage();

  const isConnected = connectionState === 'connectionStateReady';
  const effectivePhoneCodeList = phoneCodeList.length || !IS_FAMILYGRAM
    ? phoneCodeList
    : FAMILYGRAM_FALLBACK_PHONE_CODES;
  const continueText = useLangString('AuthContinueOnThisLanguage', suggestedLanguage);
  const [country, setCountry] = useState<ApiCountryCode | undefined>();
  const [phoneNumber, setPhoneNumber] = useState<string | undefined>();
  const [isTouched, setIsTouched] = useState(false);
  const [lastSelection, setLastSelection] = useState<[number, number] | undefined>();
  const [isLoading, markIsLoading, unmarkIsLoading] = useFlag();
  const [wsProbe, setWsProbe] = useState<FamilyGramWsProbeResult | 'pending'>('pending');

  const accountsInfo = useMultiaccountInfo();
  const hasActiveAccount = Object.values(accountsInfo).length > 0;
  const phoneNumberSlots = useMemo(() => (
    Object.entries(accountsInfo)
      .filter(([, info]) => info.isTest === isTestServer)
      .reduce((acc, [key, { phone }]) => {
        if (phone) acc[phone] = Number(key);
        return acc;
      }, {} as Record<string, number>)
  ), [accountsInfo, isTestServer]);

  const fullNumber = country ? `+${country.countryCode} ${phoneNumber || ''}` : phoneNumber;
  const canSubmit = fullNumber && fullNumber.replace(/[^\d]+/g, '').length >= MIN_NUMBER_LENGTH;

  useEffect(() => {
    if (!IS_TOUCH_ENV) {
      inputRef.current!.focus();
    }
  }, [country]);

  useEffect(() => {
    if (isConnected && !nearestCountry) {
      loadNearestCountry();
    }
  }, [isConnected, nearestCountry]);

  useEffect(() => {
    if (isConnected || IS_FAMILYGRAM) {
      loadCountryList({ langCode: language });
    }
  }, [isConnected, language]);

  useEffect(() => {
    if (IS_FAMILYGRAM && !nearestCountry) {
      loadNearestCountry();
    }
  }, [IS_FAMILYGRAM, nearestCountry]);

  useEffect(() => {
    if (!IS_FAMILYGRAM || isConnected) return undefined;

    let cancelled = false;
    setWsProbe('pending');
    void probeFamilyGramWebSocket().then((result) => {
      if (!cancelled) setWsProbe(result);
    });

    return () => {
      cancelled = true;
    };
  }, [IS_FAMILYGRAM, isConnected]);

  useEffect(() => {
    if (IS_FAMILYGRAM && !country && !isTouched && effectivePhoneCodeList.length) {
      const iso = nearestCountry || FAMILYGRAM_DEFAULT_COUNTRY_ISO;
      setCountry(getCountryCodeByIso(effectivePhoneCodeList, iso) || effectivePhoneCodeList[0]);
      return;
    }

    if (nearestCountry && effectivePhoneCodeList.length && !country && !isTouched) {
      setCountry(getCountryCodeByIso(effectivePhoneCodeList, nearestCountry));
    }
  }, [country, nearestCountry, isTouched, effectivePhoneCodeList]);

  const parseFullNumber = useLastCallback((newFullNumber: string) => {
    if (!newFullNumber.length) {
      setPhoneNumber('');
    }

    const suggestedCountry = effectivePhoneCodeList.length
      && getCountryFromPhoneNumber(effectivePhoneCodeList, newFullNumber);

    // Any phone numbers should be allowed, in some cases ignoring formatting
    const selectedCountry = !country
      || (suggestedCountry && suggestedCountry.iso2 !== country.iso2)
      || (!suggestedCountry && newFullNumber.length)
      ? suggestedCountry
      : country;

    if (!country || !selectedCountry || (selectedCountry && selectedCountry.iso2 !== country.iso2)) {
      setCountry(selectedCountry);
    }
    setPhoneNumber(formatPhoneNumber(newFullNumber, selectedCountry));
  });

  const handleLangChange = useLastCallback(() => {
    markIsLoading();

    void oldSetLanguage(suggestedLanguage, () => {
      unmarkIsLoading();

      setSharedSettingOption({ language: suggestedLanguage });
    });
  });

  useEffect(() => {
    if (phoneNumber === undefined && authPhoneNumber) {
      parseFullNumber(authPhoneNumber);
    }
  }, [authPhoneNumber, phoneNumber, parseFullNumber]);

  useLayoutEffect(() => {
    if (inputRef.current && lastSelection) {
      inputRef.current.setSelectionRange(...lastSelection);
    }
  }, [lastSelection]);

  const isJustPastedRef = useRef(false);
  const handlePaste = useLastCallback(() => {
    isJustPastedRef.current = true;
    requestMeasure(() => {
      isJustPastedRef.current = false;
    });
  });

  const handleBackNavigation = useLastCallback(() => {
    navigateBack();
  });

  const handleCountryChange = useLastCallback((value: ApiCountryCode) => {
    setCountry(value);
    setPhoneNumber('');
  });

  const handlePhoneNumberChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (errorKey) {
      clearAuthErrorKey();
    }

    // This is for further screens. We delay it until user input to speed up the initial loading.
    if (!isPreloadInitiated) {
      isPreloadInitiated = true;
      preloadFonts();
      void preloadImage(monkeyPath);
    }

    const { value, selectionStart, selectionEnd } = e.target;
    setLastSelection(
      selectionStart && selectionEnd && selectionEnd < value.length
        ? [selectionStart, selectionEnd]
        : undefined,
    );

    setIsTouched(true);

    const shouldFixSafariAutoComplete = (
      IS_SAFARI && country && fullNumber !== undefined
      && value.length - fullNumber.length > 1 && !isJustPastedRef.current
    );
    parseFullNumber(shouldFixSafariAutoComplete ? `${country.countryCode} ${value}` : value);
  });

  const handleKeepSessionChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAuthRememberMe({ value: e.target.checked });
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (authIsLoading) {
      return;
    }

    const adaptedPhoneNumber = fullNumber?.replace(/[^\d]/g, '');
    if (adaptedPhoneNumber && phoneNumberSlots[adaptedPhoneNumber]) {
      window.location.replace(getAccountSlotUrl(phoneNumberSlots[adaptedPhoneNumber]));
      return;
    }

    if (canSubmit) {
      setAuthPhoneNumber({ phoneNumber: fullNumber });
    }
  }

  const handleGoToAuthQrCode = useLastCallback(() => {
    goToAuthQrCode();
  });

  const handleLoginWithPasskey = useLastCallback(() => {
    loginWithPasskey();
  });

  const isAuthReady = state === 'authorizationStateWaitPhoneNumber';

  return (
    <div id="auth-phone-number-form" className="custom-scroll">
      {hasActiveAccount && (
        <Button
          size="smaller"
          round
          color="translucent"
          className="auth-close"
          iconName="close"
          onClick={handleBackNavigation}
        />
      )}
      <div className="auth-form">
        <div id="logo" />
        <h1>{lang('AuthTitle')}</h1>
        <p className="note">{lang('StartText')}</p>
        {IS_FAMILYGRAM && !isConnected && (
          <p className="note">
            {connectionState === 'connectionStateBroken'
              ? 'Cannot connect to the server. Clear site data, then reload. Ensure Testgram gateway, auth-server, and messenger-query-server are running.'
              : wsProbe === 'failed'
                ? `WebSocket to ${getFamilyGramWebSocketUrl() || 'server'} failed. Enable Websockets in NPM and proxy /apiws to gateway port 30444.`
                : wsProbe === 'ok'
                  ? 'WebSocket OK — completing MTProto handshake…'
                  : 'Connecting to server…'}
          </p>
        )}
        {IS_FAMILYGRAM && !isConnected && wsProbe === 'ok' && (
          <Button
            className="auth-button"
            isText
            onClick={() => {
              destroyConnection();
              initApi();
            }}
          >
            Retry connection
          </Button>
        )}
        <form className="form" action="" onSubmit={handleSubmit}>
          <CountryCodeInput
            id="sign-in-phone-code"
            value={country}
            isLoading={!IS_FAMILYGRAM && !nearestCountry && !country}
            onChange={handleCountryChange}
          />
          <InputText
            ref={inputRef}
            id="sign-in-phone-number"
            label={lang('LoginPhonePlaceholder')}
            value={fullNumber}
            error={errorKey && lang.withRegular(errorKey)}
            inputMode="tel"
            onChange={handlePhoneNumberChange}
            onPaste={IS_SAFARI ? handlePaste : undefined}
          />
          <Checkbox
            id="sign-in-keep-session"
            label={lang('AuthKeepSignedIn')}
            checked={Boolean(rememberMe)}
            onChange={handleKeepSessionChange}
          />
          {canSubmit && (
            isAuthReady ? (
              <Button
                className="auth-button"
                type="submit"
                ripple
                isLoading={authIsLoading}
              >
                {lang('LoginNext')}
              </Button>
            ) : (
              <Loading />
            )
          )}
          {isAuthReady && !IS_FAMILYGRAM && (
            <Button
              className="auth-button"
              isText
              ripple
              isLoading={isLoadingQrCode}
              onClick={handleGoToAuthQrCode}
            >
              {lang('LoginQRLogin')}
            </Button>
          )}
          {passkeyOption && (
            <Button className="auth-button" isText onClick={handleLoginWithPasskey}>
              {lang('LoginPasskey')}
            </Button>
          )}
          {suggestedLanguage && suggestedLanguage !== language && continueText && (
            <Button
              className="auth-button"
              isText
              isLoading={isLoading}
              onClick={handleLangChange}
            >
              {continueText}
            </Button>
          )}
        </form>
      </div>
    </div>
  );
};

export default memo(withGlobal(
  (global): Complete<StateProps> => {
    const {
      sharedState: { settings: { language } },
      countryList: { phoneCodes },
      config,
      auth,
      connectionState,
    } = global;

    const phoneCodeList = phoneCodes.length || !IS_FAMILYGRAM
      ? phoneCodes
      : FAMILYGRAM_FALLBACK_PHONE_CODES;

    return {
      auth,
      connectionState,
      language,
      phoneCodeList,
      isTestServer: config?.isTestServer,
    };
  },
)(AuthPhoneNumber));
