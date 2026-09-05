import {
  ConnectorConfig,
  DataConnect,
  ExecuteOperationResponse,
  OperationOptions,
} from 'firebase-admin/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;

export enum QuestionStatus {
  open = 'open',
  closed = 'closed',
}

export interface Answer_Key {
  id: UUIDString;
  __typename?: 'Answer_Key';
}

export interface CreateParticipantData {
  participant_insert: Participant_Key;
}

export interface FindParticipantByIdData {
  participant?: {
    id: UUIDString;
    canAsk: boolean;
    createdAt: TimestampString;
  } & Participant_Key;
}

export interface FindParticipantByIdVariables {
  id: UUIDString;
}

export interface GetQuestionByIdData {
  question?: {
    id: UUIDString;
    displayText: string;
    sourceLanguage: string;
    status: QuestionStatus;
    createdAt: TimestampString;
    participant?: {
      id: UUIDString;
    } & Participant_Key;
  } & Question_Key;
}

export interface GetQuestionByIdVariables {
  id: UUIDString;
}

export interface Participant_Key {
  id: UUIDString;
  __typename?: 'Participant_Key';
}

export interface Question_Key {
  id: UUIDString;
  __typename?: 'Question_Key';
}

/** Generated Node Admin SDK operation action function for the 'FindParticipantById' Query. Allow users to execute without passing in DataConnect. */
export function findParticipantById(
  dc: DataConnect,
  vars: FindParticipantByIdVariables,
  options?: OperationOptions,
): Promise<ExecuteOperationResponse<FindParticipantByIdData>>;
/** Generated Node Admin SDK operation action function for the 'FindParticipantById' Query. Allow users to pass in custom DataConnect instances. */
export function findParticipantById(
  vars: FindParticipantByIdVariables,
  options?: OperationOptions,
): Promise<ExecuteOperationResponse<FindParticipantByIdData>>;

/** Generated Node Admin SDK operation action function for the 'CreateParticipant' Mutation. Allow users to execute without passing in DataConnect. */
export function createParticipant(
  dc: DataConnect,
  options?: OperationOptions,
): Promise<ExecuteOperationResponse<CreateParticipantData>>;
/** Generated Node Admin SDK operation action function for the 'CreateParticipant' Mutation. Allow users to pass in custom DataConnect instances. */
export function createParticipant(
  options?: OperationOptions,
): Promise<ExecuteOperationResponse<CreateParticipantData>>;

/** Generated Node Admin SDK operation action function for the 'GetQuestionById' Query. Allow users to execute without passing in DataConnect. */
export function getQuestionById(
  dc: DataConnect,
  vars: GetQuestionByIdVariables,
  options?: OperationOptions,
): Promise<ExecuteOperationResponse<GetQuestionByIdData>>;
/** Generated Node Admin SDK operation action function for the 'GetQuestionById' Query. Allow users to pass in custom DataConnect instances. */
export function getQuestionById(
  vars: GetQuestionByIdVariables,
  options?: OperationOptions,
): Promise<ExecuteOperationResponse<GetQuestionByIdData>>;
