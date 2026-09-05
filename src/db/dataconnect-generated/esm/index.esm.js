import { validateAdminArgs } from 'firebase-admin/data-connect';

export const QuestionStatus = {
  open: 'open',
  closed: 'closed',
};

export const connectorConfig = {
  connector: 'participants-and-questions',
  serviceId: 'happen-to-have',
  location: 'us-east1',
};

export function findParticipantById(dcOrVarsOrOptions, varsOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('FindParticipantById', inputVars, inputOpts);
}

export function createParticipant(dcOrOptions, options) {
  const { dc: dcInstance, options: inputOpts } = validateAdminArgs(
    connectorConfig,
    dcOrOptions,
    options,
    undefined,
  );
  dcInstance.useGen(true);
  return dcInstance.executeMutation('CreateParticipant', undefined, inputOpts);
}

export function getQuestionById(dcOrVarsOrOptions, varsOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetQuestionById', inputVars, inputOpts);
}
