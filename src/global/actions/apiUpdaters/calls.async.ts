import type { ApiPhoneCall } from '../../../api/types';
import type { ApiCallProtocol } from '../../../lib/secret-sauce';
import type { ActionReturnType } from '../../types';

import { CALL_PROTOCOL_LIBRARY_VERSIONS } from '../../../config';
import {
  handleUpdateGroupCallConnection,
  handleUpdateGroupCallParticipants,
  joinPhoneCall, processSignalingMessage,
} from '../../../lib/secret-sauce';
import { logPhoneCallDebug } from '../../../lib/secret-sauce/phoneCallDebug';
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
let phoneCallSignalingDataPromise = Promise.resolve();

type PhoneCallState = NonNullable<ApiPhoneCall['state']>;

type QueuedPhoneCallSignalingData = {
  callId?: string;
  data: number[];
};

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

function preservePhoneCallFields(
  previousCall: ApiPhoneCall | undefined,
  call: ApiPhoneCall,
): ApiPhoneCall {
  return {
    ...call,
    gAHash: call.gAHash ?? previousCall?.gAHash,
    keyFingerprint: call.keyFingerprint ?? previousCall?.keyFingerprint,
    gAOrB: call.gAOrB ?? previousCall?.gAOrB,
    gB: call.gB ?? previousCall?.gB,
    connections: call.connections ?? previousCall?.connections,
    protocol: call.protocol ?? previousCall?.protocol,
  };
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
    return preservePhoneCallFields(previousCall, {
      ...previousCall,
      ...nextCall,
      state: previousCall?.state ?? 'waiting',
      gB: previousCall?.gB,
    });
  }

  const mergedCall: ApiPhoneCall = preservePhoneCallFields(previousCall, {
    ...previousCall,
    ...nextCall,
  });

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
  const activeCallId = call.id;

  try {
    const result = await callApi('confirmPhoneCall', [call.gB, EMOJI_DATA, EMOJI_OFFSETS]);
    if (!result) {
      logPhoneCallDebug('Failed to confirm accepted phone call', { callId: activeCallId });
      confirmedCallIds.delete(call.id);
      return;
    }

    const { gA, keyFingerprint, emojis } = result;

    let global = getGlobal();
    if (global.phoneCall?.id !== activeCallId) {
      return;
    }

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
  } catch (err) {
    confirmedCallIds.delete(call.id);
    logPhoneCallDebug('Failed to confirm accepted phone call', {
      callId: call.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function confirmAcceptedPhoneCallIfNeeded(global = getGlobal()) {
  const { phoneCall, currentUserId } = global;

  if (!shouldConfirmPhoneCall(phoneCall!, currentUserId)) {
    return;
  }

  await runPhoneCallConfirm(phoneCall!);
}

async function processPhoneCallSignalingData(queued: QueuedPhoneCallSignalingData) {
  const { data } = queued;
  let global = getGlobal();
  if (global.phoneCall?.id !== queued.callId) {
    return;
  }

  let message;
  try {
    message = await callApi('decodePhoneCallData', [data]);
  } catch (err) {
    logPhoneCallDebug('Failed to decode phone call signaling data', {
      error: err instanceof Error ? err.message : String(err),
      length: data.length,
    });
    return;
  }

  global = getGlobal();
  if (global.phoneCall?.id !== queued.callId) {
    return;
  }

  if (message) {
    await processSignalingMessage(message);
  } else {
    logPhoneCallDebug('Failed to decode phone call signaling data', {
      length: data.length,
    });
  }
}

async function startActivePhoneCall(
  call: ApiPhoneCall,
  isOutgoing: boolean,
  connections: NonNullable<ApiPhoneCall['connections']>,
  actions: {
    sendSignalingData: (...args: any[]) => void;
    apiUpdate: (...args: any[]) => void;
  },
) {
  const activeCallId = call.id;

  if (isOutgoing) {
    if (!call.keyFingerprint) {
      throw new Error('Missing phone call key fingerprint');
    }

    await callApi('verifyPhoneCallKeyFingerprint', call.keyFingerprint);
  } else {
    await callApi('receivedCall', { call });

    let global = getGlobal();
    if (global.phoneCall?.id !== activeCallId) {
      return;
    }

    if (!call.gAOrB?.length) {
      throw new Error('Missing phone call gAOrB');
    }

    if (!call.gAHash?.length) {
      throw new Error('Missing phone call gA hash');
    }

    if (!call.keyFingerprint) {
      throw new Error('Missing phone call key fingerprint');
    }

    const result = await callApi('confirmPhoneCall', [
      call.gAOrB,
      EMOJI_DATA,
      EMOJI_OFFSETS,
      {
        gAHash: call.gAHash,
        expectedKeyFingerprint: call.keyFingerprint,
      },
    ]);

    if (!result) {
      logPhoneCallDebug('Failed to confirm phone call', { callId: activeCallId });
      return;
    }

    const { emojis } = result;

    global = getGlobal();
    if (global.phoneCall?.id !== activeCallId) {
      return;
    }

    global = {
      ...global,
      phoneCall: {
        ...global.phoneCall,
        emojis,
      } as ApiPhoneCall,
    };
    setGlobal(global);
  }

  const global = getGlobal();
  if (global.phoneCall?.id !== activeCallId) {
    return;
  }

  await joinPhoneCall(
    connections,
    actions.sendSignalingData,
    isOutgoing,
    Boolean(call?.isVideo),
    Boolean(call.isP2pAllowed),
    actions.apiUpdate,
  );
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
          try {
            await startActivePhoneCall(call, isOutgoing, connections, actions);
          } catch (err) {
            logPhoneCallDebug('Failed to start phone call', {
              callId: call.id,
              error: err instanceof Error ? err.message : String(err),
            });
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

      const queued: QueuedPhoneCallSignalingData = {
        callId: phoneCall.id,
        data: update.data,
      };

      phoneCallSignalingDataPromise = phoneCallSignalingDataPromise
        .then(() => processPhoneCallSignalingData(queued))
        .catch((err) => {
          logPhoneCallDebug('Failed to process phone call signaling data', {
            error: err instanceof Error ? err.message : String(err),
            length: queued.data.length,
          });
        });
      break;
    }
  }

  return undefined;
});

function verifyPhoneCallProtocol(protocol?: ApiCallProtocol) {
  return Boolean(
    protocol
    && CALL_PROTOCOL_LIBRARY_VERSIONS.some((version) => protocol.libraryVersions.includes(version)),
  );
}