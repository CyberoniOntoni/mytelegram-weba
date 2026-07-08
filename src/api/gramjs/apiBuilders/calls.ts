import { Api as GramJs } from '../../../lib/gramjs';

import type {
  ApiCallProtocol,
  ApiPhoneCallConnection,
  GroupCallParticipant,
  GroupCallParticipantVideo,
  SsrcGroup,
} from '../../../lib/secret-sauce';
import type { ApiGroupCall, ApiPhoneCall } from '../../types';

import { getApiChatIdFromMtpPeer, isMtpPeerUser } from './peers';

export function buildApiGroupCallParticipant(participant: GramJs.GroupCallParticipant): GroupCallParticipant {
  const {
    self, min, about, date, versioned, canSelfUnmute, justJoined, left, muted, mutedByYou, source, volume,
    volumeByAdmin, videoJoined, peer, video, presentation, raiseHandRating,
  } = participant;

  return {
    isSelf: self,
    isMin: min,
    canSelfUnmute,
    isLeft: left,
    isMuted: muted,
    isMutedByMe: mutedByYou,
    hasJustJoined: justJoined,
    isVolumeByAdmin: volumeByAdmin,
    isVersioned: versioned,
    isVideoJoined: videoJoined,
    about,
    source,
    raiseHandRating: raiseHandRating?.toString(),
    volume,
    date: new Date(date),
    isUser: isMtpPeerUser(peer),
    id: getApiChatIdFromMtpPeer(peer),
    video: video ? buildApiGroupCallParticipantVideo(video) : undefined,
    presentation: presentation ? buildApiGroupCallParticipantVideo(presentation) : undefined,
  };
}

function buildApiGroupCallParticipantVideo(
  participantVideo: GramJs.GroupCallParticipantVideo,
): GroupCallParticipantVideo {
  const {
    audioSource, endpoint, paused, sourceGroups,
  } = participantVideo;
  return {
    audioSource,
    endpoint,
    isPaused: paused,
    sourceGroups: sourceGroups.map(buildApiGroupCallParticipantVideoSourceGroup),
  };
}

function buildApiGroupCallParticipantVideoSourceGroup(
  participantVideoSourceGroup: GramJs.GroupCallParticipantVideoSourceGroup,
): SsrcGroup {
  return {
    semantics: participantVideoSourceGroup.semantics,
    sources: participantVideoSourceGroup.sources,
  };
}

export function buildApiGroupCall(groupCall: GramJs.TypeGroupCall): ApiGroupCall {
  const {
    id, accessHash,
  } = groupCall;

  if (groupCall instanceof GramJs.GroupCallDiscarded) {
    return {
      connectionState: 'discarded',
      id: id.toString(),
      accessHash: accessHash.toString(),
      participantsCount: 0,
      version: 0,
      participants: {},
    };
  }

  const {
    version, participantsCount, streamDcId, scheduleDate, canChangeJoinMuted, joinMuted, canStartVideo,
    scheduleStartSubscribed,
  } = groupCall;

  return {
    connectionState: 'disconnected',
    isLoaded: true,
    id: id.toString(),
    accessHash: accessHash.toString(),
    version,
    participantsCount,
    streamDcId,
    scheduleDate,
    canChangeJoinMuted,
    joinMuted,
    canStartVideo,
    scheduleStartSubscribed,
    participants: {},
  };
}

export function getGroupCallId(groupCall: GramJs.TypeInputGroupCall) {
  if (groupCall instanceof GramJs.InputGroupCall) return groupCall.id.toString();
  return undefined;
}

type PhoneCallKind = 'waiting' | 'requested' | 'accepted' | 'active' | 'discarded';

const PHONE_CALL_CONSTRUCTOR_IDS: Record<PhoneCallKind, number> = {
  waiting: 3307368215,
  requested: 347139340,
  accepted: 912311057,
  active: 810769141,
  discarded: 1355435489,
};

function bytesToNumberArray(value: Buffer | Uint8Array | number[] | undefined): number[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value;
  return Array.from(value);
}

function getPhoneCallKind(call: GramJs.TypePhoneCall): PhoneCallKind | undefined {
  if (call instanceof GramJs.PhoneCallWaiting) return 'waiting';
  if (call instanceof GramJs.PhoneCallRequested) return 'requested';
  if (call instanceof GramJs.PhoneCallAccepted) return 'accepted';
  if (call instanceof GramJs.PhoneCall) return 'active';
  if (call instanceof GramJs.PhoneCallDiscarded) return 'discarded';

  const constructorId = (call as { CONSTRUCTOR_ID?: number }).CONSTRUCTOR_ID;
  if (constructorId) {
    const entry = Object.entries(PHONE_CALL_CONSTRUCTOR_IDS).find(([, id]) => id === constructorId);
    if (entry) return entry[0] as PhoneCallKind;
  }

  const rawCall = call as unknown as Record<string, unknown>;
  if (rawCall.gAOrB != null || rawCall.g_a_or_b != null) return 'active';
  if (rawCall.gB != null || rawCall.g_b != null) return 'accepted';
  if (rawCall.gAHash != null || rawCall.g_a_hash != null) return 'requested';
  if (rawCall.reason != null) return 'discarded';
  if (rawCall.protocol != null) return 'waiting';

  return undefined;
}

function readPhoneCallFields(call: GramJs.TypePhoneCall) {
  const rawCall = call as unknown as Record<string, unknown>;

  return {
    accessHash: rawCall.accessHash ?? rawCall.access_hash,
    adminId: rawCall.adminId ?? rawCall.admin_id,
    participantId: rawCall.participantId ?? rawCall.participant_id,
    date: rawCall.date,
    video: rawCall.video,
    protocol: rawCall.protocol,
    receiveDate: rawCall.receiveDate ?? rawCall.receive_date,
    gB: rawCall.gB ?? rawCall.g_b,
    gAHash: rawCall.gAHash ?? rawCall.g_a_hash,
    gAOrB: rawCall.gAOrB ?? rawCall.g_a_or_b,
    keyFingerprint: rawCall.keyFingerprint ?? rawCall.key_fingerprint,
    connections: rawCall.connections,
    startDate: rawCall.startDate ?? rawCall.start_date,
    p2pAllowed: rawCall.p2pAllowed ?? rawCall.p2p_allowed,
    reason: rawCall.reason,
    duration: rawCall.duration,
    needRating: rawCall.needRating ?? rawCall.need_rating,
    needDebug: rawCall.needDebug ?? rawCall.need_debug,
  };
}

export function buildPhoneCall(call: GramJs.TypePhoneCall): ApiPhoneCall {
  const kind = getPhoneCallKind(call);
  const fields = readPhoneCallFields(call);

  let phoneCall: ApiPhoneCall = {
    id: call.id.toString(),
  };

  if (kind && kind !== 'discarded' && fields.accessHash != null && fields.adminId != null && fields.participantId != null) {
    phoneCall = {
      ...phoneCall,
      accessHash: fields.accessHash.toString(),
      adminId: fields.adminId.toString(),
      participantId: fields.participantId.toString(),
      date: fields.date as number | undefined,
      isVideo: Boolean(fields.video),
      protocol: fields.protocol ? buildApiCallProtocol(fields.protocol as GramJs.PhoneCallProtocol) : undefined,
    };
  }

  switch (kind) {
    case 'active': {
      const gAOrB = bytesToNumberArray(fields.gAOrB as Buffer | Uint8Array | number[] | undefined);
      phoneCall = {
        ...phoneCall,
        state: 'active',
        gAOrB,
        keyFingerprint: fields.keyFingerprint?.toString(),
        startDate: fields.startDate as number | undefined,
        isP2pAllowed: Boolean(fields.p2pAllowed),
        connections: Array.isArray(fields.connections)
          ? fields.connections.map(buildApiCallConnection).filter(Boolean)
          : undefined,
      };
      break;
    }
    case 'discarded':
      phoneCall = {
        ...phoneCall,
        state: 'discarded',
        duration: fields.duration as number | undefined,
        reason: buildApiCallDiscardReason(fields.reason as GramJs.TypePhoneCallDiscardReason | undefined),
        needRating: Boolean(fields.needRating),
        needDebug: Boolean(fields.needDebug),
      };
      break;
    case 'waiting':
      phoneCall = {
        ...phoneCall,
        state: 'waiting',
        receiveDate: fields.receiveDate as number | undefined,
      };
      break;
    case 'accepted': {
      const gB = bytesToNumberArray(fields.gB as Buffer | Uint8Array | number[] | undefined);
      phoneCall = {
        ...phoneCall,
        state: 'accepted',
        gB,
      };
      break;
    }
    case 'requested': {
      const gAHash = bytesToNumberArray(fields.gAHash as Buffer | Uint8Array | number[] | undefined);
      phoneCall = {
        ...phoneCall,
        state: 'requested',
        gAHash,
      };
      break;
    }
    default:
      break;
  }

  return phoneCall;
}

export function buildApiCallDiscardReason(discardReason?: GramJs.TypePhoneCallDiscardReason) {
  if (discardReason instanceof GramJs.PhoneCallDiscardReasonMissed) {
    return 'missed';
  } else if (discardReason instanceof GramJs.PhoneCallDiscardReasonBusy) {
    return 'busy';
  } else if (discardReason instanceof GramJs.PhoneCallDiscardReasonHangup) {
    return 'hangup';
  } else {
    return 'disconnect';
  }
}

function buildApiCallConnection(connection: GramJs.TypePhoneConnection): ApiPhoneCallConnection | undefined {
  if (connection instanceof GramJs.PhoneConnectionWebrtc) {
    const {
      username, password, turn, stun, ip, ipv6, port,
    } = connection;

    return {
      username,
      password,
      isTurn: turn,
      isStun: stun,
      ip,
      ipv6,
      port,
    };
  } else {
    return undefined;
  }
}

export function buildApiCallProtocol(protocol: GramJs.PhoneCallProtocol): ApiCallProtocol {
  const rawProtocol = protocol as unknown as Record<string, unknown>;
  const libraryVersions = protocol.libraryVersions
    ?? (rawProtocol.LibraryVersions as string[] | undefined)
    ?? [];
  const minLayer = protocol.minLayer ?? (rawProtocol.MinLayer as number | undefined) ?? 65;
  const maxLayer = protocol.maxLayer ?? (rawProtocol.MaxLayer as number | undefined) ?? 92;
  const isUdpP2p = protocol.udpP2p ?? (rawProtocol.UdpP2p as boolean | undefined) ?? true;
  const isUdpReflector = protocol.udpReflector ?? (rawProtocol.UdpReflector as boolean | undefined) ?? true;

  return {
    libraryVersions,
    minLayer,
    maxLayer,
    isUdpP2p,
    isUdpReflector,
  };
}

export function buildCallProtocol() {
  // Testgram validates minLayer=65 and maxLayer=92 (Telegram legacy voice-call range).
  return new GramJs.PhoneCallProtocol({
    libraryVersions: ['2.7.7'],
    minLayer: 65,
    maxLayer: 92,
    udpReflector: true,
    udpP2p: true,
  });
}
