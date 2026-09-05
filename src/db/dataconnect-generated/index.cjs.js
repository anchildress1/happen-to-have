const { validateAdminArgs } = require('firebase-admin/data-connect');

const QuestionStatus = {
  open: 'open',
  closed: 'closed',
};
exports.QuestionStatus = QuestionStatus;

const connectorConfig = {
  connector: 'participants-and-questions',
  serviceId: 'happen-to-have',
  location: 'us-east1',
};
exports.connectorConfig = connectorConfig;

function findParticipantById(dcOrVarsOrOptions, varsOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('FindParticipantById', inputVars, inputOpts);
}
exports.findParticipantById = findParticipantById;

function createParticipant(dcOrOptions, options) {
  const { dc: dcInstance, options: inputOpts } = validateAdminArgs(
    connectorConfig,
    dcOrOptions,
    options,
    undefined,
  );
  dcInstance.useGen(true);
  return dcInstance.executeMutation('CreateParticipant', undefined, inputOpts);
}
exports.createParticipant = createParticipant;

function getQuestionById(dcOrVarsOrOptions, varsOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetQuestionById', inputVars, inputOpts);
}
exports.getQuestionById = getQuestionById;
