import {
  findSdpLineValue,
  parseExtmaps,
  parseFingerprints,
  parsePayloadTypes,
  parseSdpSections,
  parseSsrcGroups,
  parseSsrcs,
} from './sdp/common';
import { toTelegramSource } from './utils';
import type { JoinGroupCallPayload, SsrcGroup } from './types';

function buildSsrcGroup(section: ReturnType<typeof parseSdpSections>[number]): SsrcGroup | undefined {
  const groups = parseSsrcGroups(section);
  if (groups.length) {
    return {
      semantics: groups[0].semantics,
      sources: groups[0].ssrcs.map(toTelegramSource),
    };
  }

  const ssrcs = parseSsrcs(section, true);
  if (!ssrcs.length) {
    return undefined;
  }

  return {
    semantics: 'FID',
    sources: ssrcs.map(toTelegramSource),
  };
}

function getMediaSection(
  sections: ReturnType<typeof parseSdpSections>,
  kind: string,
  index = 0,
) {
  return sections.filter((section) => section.kind === kind)[index];
}

export default (sessionDescription: RTCSessionDescriptionInit, isP2p = false): JoinGroupCallPayload => {
  if (!sessionDescription?.sdp) {
    throw Error('Failed parsing SDP: session description is null');
  }

  const sections = parseSdpSections(sessionDescription.sdp);
  const audioSection = getMediaSection(sections, 'audio');
  const videoSection = getMediaSection(sections, 'video', 0);
  const screencastSection = getMediaSection(sections, 'video', 1) ?? videoSection;

  const ufrag = findSdpLineValue(sections, 'a=ice-ufrag:');
  const pwd = findSdpLineValue(sections, 'a=ice-pwd:');
  const fingerprints = parseFingerprints(sections);
  const setup = findSdpLineValue(sections, 'a=setup:');

  if (!ufrag || !pwd || !fingerprints.length) {
    throw Error('Failed parsing SDP: missing ICE transport attributes');
  }

  const audioSsrc = audioSection ? parseSsrcs(audioSection, true)[0] : undefined;
  const videoGroup = videoSection ? buildSsrcGroup(videoSection) : undefined;
  const screencastGroup = screencastSection ? buildSsrcGroup(screencastSection) : videoGroup;

  if (!videoGroup?.sources?.length && !isP2p) {
    throw Error('Failed parsing SDP: no video ssrc');
  }

  return {
    fingerprints: fingerprints.map((fingerprint) => ({
      ...fingerprint,
      setup: isP2p ? (setup || fingerprint.setup) : 'active',
    })),
    pwd,
    ufrag,
    ...(audioSsrc && { ssrc: toTelegramSource(audioSsrc) }),
    'ssrc-groups': [
      ...(videoGroup ? [videoGroup] : []),
      ...(isP2p && screencastGroup && screencastGroup !== videoGroup ? [screencastGroup] : []),
    ] as SsrcGroup[],
    ...(isP2p && audioSection && videoSection && screencastSection && {
      audioExtmap: parseExtmaps(audioSection),
      videoExtmap: parseExtmaps(videoSection),
      screencastExtmap: parseExtmaps(screencastSection),
      audioPayloadTypes: parsePayloadTypes(audioSection),
      videoPayloadTypes: parsePayloadTypes(videoSection),
      screencastPayloadTypes: parsePayloadTypes(screencastSection),
    }),
  };
};