import { DEBUG_CALLS } from '../../config';
import { logDebugMessage } from '../../util/debugConsole';

export function logPhoneCallDebug(message: string, data?: Record<string, unknown>) {
  if (!DEBUG_CALLS) return;

  if (data) {
    logDebugMessage('warn', `[PhoneCall] ${message}`, data);
    return;
  }

  logDebugMessage('warn', `[PhoneCall] ${message}`);
}