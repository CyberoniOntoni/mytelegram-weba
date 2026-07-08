import type { ApiPhoneCall } from '../../../api/types';
import type { ApiCallProtocol } from '../../../lib/secret-sauce';
import type { ActionReturnType } from '../../types';

import {
  handleUpdateGroupCallConnection,
  handleUpdateGroupCallParticipants,
  joinPhoneCall, processSignalingMessage,
} from '../../../lib/secret-sauce';
import { ARE_CALLS_SUPPORTED } from '../../../util/browser/windowEnvironment';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { omit } from '../../../util/iteratees';
import * as langProvider from '../../../util/oldLangProvider';
import { EMOJI_DATA, EMOJI_OFFSETS } from '../../../util/phoneCallEmojiConstants';
import { callApi } from '../../../api/gramjs';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import { updateGroupCall, updateGroupCallParticipant } from '../../reducers/calls';
import { updateTabState } from '../../reducers/tabs';
import { selectActiveGroupCall, selectGroupCallParticipant, selectPhoneCallUser } from '../../selectors/calls';

const confirmedCallIds = new Set<string>();

type PhoneCallState = NonNullable<ApiPhoneCall['state']>;

const PHONE_CALL_STATE_RANK: Record<PhoneCallState, number> = {
  requesting: 0,
  requested: 1,
  waiting: 2,
  accepted: 3,
  active: 4,
  discarded: -1,
};

function isPhoneCallStateRegression(previousState?: PhoneCallState, nextState?: PhoneCallState) {
  if (!previousState || !nextState) return false;

  const previousRank = PHONE_CALL_STATE_RANK[previousState] ?? 0;
  const nextRank = PHONE_CALL_STATE_RANK[nextState] ?? 0;

  return nextRank < previousRank;
}

function normalizeUserId(userId?: string | number) {
  return userId?.toString();
}

function mergePhoneCallUpdate(
  previousCall: ApiPhoneCall | undefined,
  nextCall: ApiPhoneCall,
  currentUserId?: string,
): ApiPhoneCall {
  const normalizedCurrentUserId = normalizeUserId(currentUserId);
  const normalizedAdminId = normalizeUserId(nextCall.adminId);

  // Accepted updates are caller-only. Ignore misrouted pushes on the callee device.
  if (
    nextCall.state === 'accepted'
    && normalizedAdminId
    && normalizedCurrentUserId
    && normalizedAdminId !== normalizedCurrentUserId
  ) {
    return {
      ...previousCall,
      ...nextCall,
      state: previousCall?.state ?? 'waiting',
      gB: previousCall?.gB,
    };
  }

  const mergedCall: ApiPhoneCall = {
    ...previousCall,
    ...nextCall,
  };

  if (isPhoneCallStateRegression(previousCall?.state, nextCall.state)) {
    return {
      ...mergedCall,
      state: previousCall!.state,
      gB: previousCall?.gB ?? mergedCall.gB,
      gAOrB: previousCall?.gAOrB ?? mergedCall.gAOrB,
      connections: previousCall?.connections ?? mergedCall.connections,
      protocol: previousCall?.protocol ?? mergedCall.protocol,
      accessHash: nextCall.accessHash ?? previousCall?.accessHash ?? mergedCall.accessHash,
    };
  }

  return mergedCall;
}

function shouldConfirmPhoneCall(call: ApiPhoneCall, currentUserId?: string) {
  return Boolean(
    call.state === 'accepted'
    && call.accessHash
    && call.gB?.length
    && normalizeUserId(call.adminId) === normalizeUserId(currentUserId)
    && !confirmedCallIds.has(call.id),
  );
}

async function runPhoneCallConfirm(call: ApiPhoneCall) {
  if (!call.gB?.length || confirmedCallIds.has(call.id)) {
    return;
  }

  confirmedCallIds.add(call.id);

  try {
    const { gA, keyFingerprint, emojis } = await callApi('confirmPhoneCall', [call.gB, EMOJI_DATA, EMOJI_OFFSETS]);

    let global = getGlobal();
    global = {
      ...global,
      phoneCall: {
        ...global.phoneCall,
        emojis,
      } as ApiPhoneCall,
    };
    setGlobal(global);

    await callApi('confirmCall', {
      call, gA, keyFingerprint,
    });
  } catch {
    confirmedCallIds.delete(call.id);
  }
}

export async function confirmAcceptedPhoneCallIfNeeded(global = getGlobal()) {
  const { phoneCall, currentUserId } = global;

  if (!shouldConfirmPhoneCall(phoneCall!, currentUserId)) {
    return;
  }

  await runPhoneCallConfirm(phoneCall!);
}

addActionHandler('apiUpdate', (global, actions, update): ActionReturnType => {
  const { activeGroupCallId } = global.groupCalls;

  switch (update['@type']) {
    case 'updateGroupCallLeavePresentation': {
      actions.toggleGroupCallPresentation({ value: false });
      break;
    }
    case 'updateGroupCallStreams': {
      if (!update.userId || !activeGroupCallId) break;
      if (!selectGroupCallParticipant(global, activeGroupCallId, update.userId)) break;

      return updateGroupCallParticipant(global, activeGroupCallId, update.userId, omit(update, ['@type', 'userId']));
    }
    case 'updateGroupCallConnectionState': {
      if (!activeGroupCallId) break;

      if (update.connectionState === 'disconnected') {
        if ('leaveGroupCall' in actions) actions.leaveGroupCall({ isFromLibrary: true, tabId: getCurrentTabId() });
        break;
      }

      return updateGroupCall(global, activeGroupCallId, {
        connectionState: update.connectionState,
        isSpeakerDisabled: update.isSpeakerDisabled,
      });
    }
    case 'updateGroupCallParticipants': {
      const { groupCallId, participants } = update;
      if (activeGroupCallId === groupCallId) {
        void handleUpdateGroupCallParticipants(participants);
      }
      break;
    }
    case 'updateGroupCallConnection': {
      if (update.data.stream) {
        actions.showNotification({ message: 'Big live streams are not yet supported', tabId: getCurrentTabId() });
        if ('leaveGroupCall' in actions) actions.leaveGroupCall({ tabId: getCurrentTabId() });
        break;
      }
      void handleUpdateGroupCallConnection(update.data, update.presentation);

      const groupCall = selectActiveGroupCall(global);
      if (groupCall?.participants && Object.keys(groupCall.participants).length > 0) {
        void handleUpdateGroupCallParticipants(Object.values(groupCall.participants));
      }
      break;
    }
    case 'updatePhoneCallMediaState':
      return {
        ...global,
        phoneCall: {
          ...global.phoneCall,
          ...omit(update, ['@type']),
        } as ApiPhoneCall,
      };
    case 'updatePhoneCall': {
      if (!ARE_CALLS_SUPPORTED) return undefined;
      const { phoneCall, currentUserId } = global;

      const call = mergePhoneCallUpdate(phoneCall, update.call, currentUserId);

      const isOutgoing = normalizeUserId(call.adminId) === normalizeUserId(currentUserId);

      global = {
        ...global,
        phoneCall: call,
      };
      setGlobal(global);
      global = getGlobal();

      if (phoneCall && phoneCall.id && call.id !== phoneCall.id) {
        if (call.state !== 'discarded') {
          callApi('discardCall', {
            call,
            isBusy: true,
          });
        }
        return undefined;
      }

      const {
        accessHash, state, connections, gB,
      } = call;

      if (state === 'active' || state === 'accepted') {
        if (!verifyPhoneCallProtocol(call.protocol)) {
          const user = selectPhoneCallUser(global);
          if ('hangUp' in actions) actions.hangUp({ tabId: getCurrentTabId() });
          actions.showNotification({
            message: langProvider.oldTranslate('VoipPeerIncompatible', user?.firstName),
            tabId: getCurrentTabId(),
          });
          return undefined;
        }
      }

      if (state === 'discarded') {
        confirmedCallIds.delete(call.id);

        // Discarded from other device
        if (!phoneCall) return undefined;

        return updateTabState(global, {
          ...(call.needRating && { ratingPhoneCall: call }),
          isCallPanelVisible: undefined,
        }, getCurrentTabId());
      } else if (shouldConfirmPhoneCall(call, currentUserId)) {
        void runPhoneCallConfirm(call);
      } else if (state === 'active' && connections && phoneCall?.state !== 'active') {
        void (async () => {
          if (!isOutgoing) {
            callApi('receivedCall', { call });
            const { emojis } = await callApi('confirmPhoneCall', [call.gAOrB!, EMOJI_DATA, EMOJI_OFFSETS]);

            global = getGlobal();
            global = {
              ...global,
              phoneCall: {
                ...global.phoneCall,
                emojis,
              } as ApiPhoneCall,
            };
            setGlobal(global);
          }

          try {
            await joinPhoneCall(
              connections,
              actions.sendSignalingData,
              isOutgoing,
              Boolean(call?.isVideo),
              Boolean(call.isP2pAllowed),
              actions.apiUpdate,
            );
          } catch (err) {
            console.error('[PhoneCall] Failed to join phone call:', err);
          }
        })();
      }

      return global;
    }
    case 'updatePhoneCallConnectionState': {
      const { connectionState } = update;

      if (!global.phoneCall) return global;

      if (connectionState === 'closed' || connectionState === 'disconnected' || connectionState === 'failed') {
        if ('hangUp' in actions) actions.hangUp({ tabId: getCurrentTabId() });
        return undefined;
      }

      return {
        ...global,
        phoneCall: {
          ...global.phoneCall,
          isConnected: connectionState === 'connected',
        },
      };
    }
    case 'updatePhoneCallSignalingData': {
      const { phoneCall } = global;

      if (!phoneCall) {
        break;
      }

      callApi('decodePhoneCallData', [update.data])?.then(processSignalingMessage);
      break;
    }
  }

  return undefined;
});

const SUPPORTED_CALL_LIBRARY_VERSIONS = new Set(['4.0.0', '4.0.1', '2.7.7']);

function verifyPhoneCallProtocol(protocol?: ApiCallProtocol) {
  return Boolean(protocol?.libraryVersions.some((version) => SUPPORTED_CALL_LIBRARY_VERSIONS.has(version)));
}
