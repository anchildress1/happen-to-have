import {
  createParticipant as generatedCreateParticipant,
  findParticipantById as generatedFindParticipantById,
} from '@happen-to-have/dataconnect-generated';
import { z } from 'zod';
import { getConnector } from '../client.js';

/**
 * The only shape `getOrCreateParticipant` (src/session/session.ts) needs from
 * either operation is the participant's id — it never reads `can_ask` (T033
 * forbids it from ever reaching the session anyway) or `created_at`. Using
 * SQL Connect's generated Admin SDK operations (dataconnect/connector/*.gql,
 * re-exported from `src/db/client.ts`, owned by another agent) is therefore
 * sufficient per T031, with no native-SQL fallback needed: `createParticipant`
 * returns only `Participant_Key` (an id) regardless, and fetching columns
 * nobody consumes would be exactly the speculative work Principle VI forbids.
 */
export interface ParticipantsClient {
  findParticipantById(id: string): Promise<{ id: string } | null>;
  createParticipant(): Promise<{ id: string }>;
}

const participantIdSchema = z.object({ id: z.uuid() });

/** The real implementation, backed by SQL Connect's generated Admin SDK operations. */
export const participantsClient: ParticipantsClient = {
  async findParticipantById(id) {
    const { data } = await generatedFindParticipantById(getConnector(), { id });
    if (!data.participant) {
      return null;
    }
    return participantIdSchema.parse({ id: data.participant.id });
  },

  async createParticipant() {
    const { data } = await generatedCreateParticipant(getConnector());
    return participantIdSchema.parse(data.participant_insert);
  },
};
