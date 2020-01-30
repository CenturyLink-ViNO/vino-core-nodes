/* globals module */
/* globals console*/
/* globals require*/
const NodeUtilities = require('./driver-utils/index');
const Parameter = NodeUtilities.Parameter;
const utils = NodeUtilities.Utils;

function convertParams(step)
{
   if (step.inputParameters)
   {
      step.inputParameters.forEach(function(param, index)
      {
         step.inputParameters[index] = new Parameter(param);
      });
   }
}

function getInputSteps(steps)
{
   const ret = {};
   if (steps && Array.isArray(steps))
   {
      steps.forEach(function(step)
      {
         convertParams(step);
         ret[step.id] = step;
         if (step.steps)
         {
            Object.assign(ret, getInputSteps(step.steps));
         }
         if (step.trueSteps)
         {
            Object.assign(ret, getInputSteps(step.trueSteps));
         }
         if (step.falseSteps)
         {
            Object.assign(ret, getInputSteps(step.falseSteps));
         }
      });
   }
   return ret;
}

function getStepsMapFromList(stepList)
{
   if (!stepList || !Array.isArray(stepList))
   {
      return;
   }
   const stepsMap = {};
   stepList.forEach(function(stepNode)
   {
      if (!stepsMap[stepNode.nodeId])
      {
         stepsMap[stepNode.nodeId] = [];
      }
      if (stepNode.steps)
      {
         stepNode.steps.forEach(function(step)
         {
            const inputParamsMap = {};
            const outputParamsMap = {};
            step.inputParameters.forEach(function(param)
            {
               inputParamsMap[param.parameterKey] = new Parameter(param);
            });
            step.outputParameters.forEach(function(param)
            {
               outputParamsMap[param.parameterKey] = new Parameter(param);
            });
            step.inputParameters = inputParamsMap;
            step.outputParameters = outputParamsMap;
            stepsMap[stepNode.nodeId].push(step);
         });
      }
   });
   return stepsMap;
}

class VinoServiceActivation
{
   constructor(activationId, node, data, deactivation)
   {
      if (!node.context().global.vinoServiceActivations)
      {
         node.context().global.vinoServiceActivations = {};
      }
      const context = node.context().global.vinoServiceActivations;
      if (context[activationId])
      {
         console.log('Already registered an activation with id: ' + activationId);
         throw new Error('Already registered an activation with id: ' + activationId);
      }
      if (deactivation)
      {
         this.activationInputSteps = [];
         this.status = data.status || [];
         this.activatedSteps = getStepsMapFromList(data.steps);
         // TODO need to set deactivation starting status
      }
      else
      {
         this.activationInputSteps = getInputSteps(data.steps);
         this.status =
         [
            {
               'status': 'Starting',
               'time': Date.now(),
               'message': 'Starting activation of service. Activation ID: ' + activationId,
               'jobId': activationId,
               'statusIndex': 0
            }
         ];
         this.inputTemplate = data;
         this.activatedSteps = {};
      }
      this.id = activationId;
      this.referenceId = node.serviceRegistrationId;
      this.name = node.name;
      this.description = node.description;
      this.customerName = data.customerName || 'ViNO';
      this.settingsRootGroup = data.settingsRootGroup;
      this.notes = data.notes;
      this.startTime = Date.now();
      this.cancel = false;
      this.debug = data.debug;
      context[activationId] = this;
   }

   setStepActivationInput(stepId, input)
   {
      if (this.activationInputSteps)
      {
         this.activationInputSteps[stepId] = input;
      }
      else
      {
         throw new Error(`Activation with ID ${this.id} has no Input Steps to reference.`);
      }
   }

   getStepActivationInput(stepId)
   {
      if (this.activationInputSteps)
      {
         if (this.activationInputSteps.hasOwnProperty(stepId))
         {
            return this.activationInputSteps[stepId];
         }
      }
      else
      {
         throw new Error(`Activation with ID ${this.id} has no Input Steps to reference.`);
      }
   }

   completeServiceActivation()
   {
      this.setStatus('Complete', 'Service activation completed successfully.');
   }

   completeServiceDeactivation(wasRollback, hadErrors)
   {
      let msg = 'Service deactivation completed ';
      if (wasRollback)
      {
         msg = 'Service failed to activate. Rollback completed ';
      }
      if (hadErrors)
      {
         msg += 'with errors. Some service steps may not be deactivated.';
      }
      else
      {
         msg += 'successfully';
      }
      this.setStatus('Deactivated', msg);
   }

   failServiceActivation(cancelled, rollBack)
   {
      const status = rollBack ? 'Failure' : 'Failed';
      let message = 'Service activation failed to complete successfully.';
      if (cancelled)
      {
         message = 'Service activation was canceled by user';
      }
      this.setStatus(status, message);
   }

   removeServiceActivation(context)
   {
      delete context.global.vinoServiceActivations[this.id];
   }

   getStatus()
   {
      return this.status;
   }

   setStatus(status, message, node)
   {
      if (this.shouldDisplayMessage(status, node))
      {
         let statusMessage = message;
         if (this.debug && node)
         {
            let nodeId = node.id;
            if (node._alias) // eslint-disable-line
            {
               nodeId = node._alias; // eslint-disable-line
            }
            statusMessage = `[Node: ${nodeId}] ` + message;
         }
         this.status.push({
            'status': status,
            'time': Date.now(),
            'message': statusMessage,
            'jobId': this.id,
            'statusIndex': this.status.length
         });
      }
   }

   shouldDisplayMessage(status, node)
   {
      let ret = false;
      if (node && node.statusConfiguration)
      {
         const config = node.statusConfiguration;
         let statusConfigSetting;
         switch (status)
         {
         case 'Starting':
         case 'Activating':
            statusConfigSetting = config.starting;
            break;
         case 'Failure':
         case 'Failed':
            statusConfigSetting = config.failures;
            break;
         case 'Complete':
         case 'Success':
            statusConfigSetting = config.completed;
            break;
         case 'Retry':
            statusConfigSetting = config.retries;
            break;
         default:
            break;
         }
         if (statusConfigSetting === undefined || statusConfigSetting === 'always' || statusConfigSetting === 'debug' && this.debug)
         {
            ret = true;
         }
      }
      else
      {
         ret = true;
      }
      return ret;
   }

   getActivationData()
   {
      return this;
   }

   // This should be called after each node completes activation and should pass in lists of the input and output
   // parameters.
   stepActivated(node, inputParams = [], outputParams = [], customMsg, msgObject)
   {
      if (!node)
      {
         return;
      }
      let nodeId = node.id;
      let message = customMsg || `Step '${node.name}' activated successfully`;
      utils.log(message, node, msgObject);
      if (this.debug)
      {
         message = `[Node: ${node.id}] ` + message;
      }
      // Each instance of a subflow creates new instances of the nodes within it whose IDs change with every deploy
      // The alias field contains the ID of the node instance in the subflow template which is fixed
      // TODO: can we safely assume if this field is present it must be a node in a subflow
      if (node._alias) // eslint-disable-line
      {
         nodeId = node._alias;  // eslint-disable-line
      }
      if (this.shouldDisplayMessage('Success', node))
      {
         this.status.push({
            'status': 'Success',
            'time': Date.now(),
            'message': message,
            'inputParameters': inputParams,
            'outputParameters': outputParams,
            'jobId': this.id,
            'statusIndex': this.status.length
         });
      }
      // We actually store an array for each node ID since it's possible for nodes to be activated multiple times
      if (!this.activatedSteps[nodeId])
      {
         this.activatedSteps[nodeId] = [];
      }
      const inputParamsMap = {};
      const outputParamsMap = {};
      inputParams.forEach(function(param)
      {
         inputParamsMap[param.parameterKey] = param;
      });
      outputParams.forEach(function(param)
      {
         outputParamsMap[param.parameterKey] = param;
      });
      this.activatedSteps[nodeId].push({
         'nodeId': node.id,
         'name': node.name,
         'description': node.description,
         'iterationCount': this.activatedSteps[nodeId].length,
         'activatedTime': Date.now(),
         'inputParameters': inputParamsMap,
         'outputParameters': outputParamsMap
      });
   }
   // This should be called at the start of each node activation
   stepActivating(node, msgObject)
   {
      const statusMessage = `Step '${node.name}' started activating`;
      this.setStatus('Activating', statusMessage, node);
      utils.log(statusMessage, node, msgObject);
   }
   stepFailed(node, errorMsg, msgObject)
   {
      const statusMessage = `Step '${node.name}' failed to activate. ${errorMsg}`;
      this.setStatus('Failure', statusMessage, node);
      utils.error(statusMessage, node, msgObject);
   }
   stepDeactivating(node, msgObject)
   {
      const statusMessage = `Deactivation step '${node.name}' starting.`;
      this.setStatus('Deactivating', statusMessage, node);
      utils.log(statusMessage, node, msgObject);
   }
   stepDeactivated(node, msgObject)
   {
      const statusMessage = `Deactivation step '${node.name}' completed successfully.`;
      this.setStatus('Success', statusMessage, node);
      utils.log(statusMessage, node, msgObject);
   }
   stepDeactivateFailed(node, errorMsg, msgObject)
   {
      const statusMessage = `Deactivation step '${node.name}' failed. ${errorMsg}`;
      this.setStatus('Failure', statusMessage, node);
      utils.error(statusMessage, node, msgObject);
   }
   // Given a specified activation, target node and parameter key, return the input parameter value if found
   getInputParameter(targetNodeId, key, iterationCount)
   {
      let count = iterationCount;
      try
      {
         const step = this.activatedSteps[targetNodeId];
         if (!count)
         {
            count = step.length - 1;
         }
         return step[count].inputParameters[key];
      }
      catch (error)
      {
         console.error('Could not find the requested parameter');
      }
   }
   // Given a specified activation, target node and parameter key, return the output parameter value if found
   getOutputParameter(targetNodeId, key, iterationCount)
   {
      let count = iterationCount;
      try
      {
         const step = this.activatedSteps[targetNodeId];
         if (!count)
         {
            count = step.length - 1;
         }
         return step[count].outputParameters[key];
      }
      catch (error)
      {
         console.error('Could not find the requested parameter');
      }
   }
   // Returns a list containing all known input parameters for the specified activation
   getAllInputParameters()
   {
      const steps = this.activatedSteps;
      const ret = [];
      let nodeIndex;
      for (const nodeId in steps)
      {
         if (steps.hasOwnProperty(nodeId))
         {
            for (nodeIndex = 0; nodeIndex < steps[nodeId].length; nodeIndex = nodeIndex + 1)
            {
               for (const paramKey in steps[nodeId][nodeIndex].inputParameters)
               {
                  if (steps[nodeId][nodeIndex].inputParameters.hasOwnProperty(paramKey))
                  {
                     ret.push({
                        'nodeId': nodeId,
                        'interationCount': nodeIndex,
                        'key': paramKey,
                        'value': steps[nodeId][nodeIndex].inputParameters[paramKey]
                     });
                  }
               }
            }
         }
      }
      return ret;
   }
   // Returns a list containing all known output parameters for the specified activation
   getAllOutputParameters()
   {
      const steps = this.activatedSteps;
      const ret = [];
      let nodeIndex;
      for (const nodeId in steps)
      {
         if (steps.hasOwnProperty(nodeId))
         {
            for (nodeIndex = 0; nodeIndex < steps[nodeId].length; nodeIndex = nodeIndex + 1)
            {
               for (const paramKey in steps[nodeId][nodeIndex].outputParameters)
               {
                  if (steps[nodeId][nodeIndex].outputParameters.hasOwnProperty(paramKey))
                  {
                     ret.push({
                        'nodeId': nodeId,
                        'interationCount': nodeIndex,
                        'key': paramKey,
                        'value': steps[nodeId][nodeIndex].outputParameters[paramKey]
                     });
                  }
               }
            }
         }
      }
      return ret;
   }
   checkForCancellation(node, msg)
   {
      // If we're on the deactivation flow we ignore the cancel flag
      if (node.isDeactivationNode)
      {
         return false;
      }
      if (this.cancel)
      {
         msg.vino.cancelled = true;
         this.setStatus('Cancelled', 'Service activation successfully cancelled');
         node.error('Service Activation Cancelled', msg);
         return true;
      }
      return false;
   }
   // Wrapper for calling node.error(0) only on activaton nodes and continuing if a deactivation node fails
   error(node, errorMessage, msg)
   {
      if (node.isDeactivationNode)
      {
         this.stepDeactivateFailed(node, errorMessage, msg);
         msg.vino.deactivationError = true;
         node.send(msg);
      }
      else
      {
         this.stepFailed(node, errorMessage, msg);
         utils.debug('Calling node.error()', node, msg);
         node.error(errorMessage, msg);
      }
   }
}

module.exports = VinoServiceActivation;
