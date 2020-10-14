/* globals module*/
/* globals require*/
/* eslint complexity: ["off"] */

const NodeUtilities = require('vino-node-red-nodes/lib/driver-utils');
const Parameter = NodeUtilities.Parameter;
const settingsObject = require('./config/loop-start');
const inspect = require('util').inspect;
module.exports = function(RED)
{
   const utils = NodeUtilities.Utils;
   const VinoNodeUtility = NodeUtilities.VinoNodeUtility;

   function findMatchingEndNode(loopStartNode, subflowInstanceNodes)
   {
      let found;
      if (loopStartNode.type !== 'loop start')
      {
         return;
      }
      if (subflowInstanceNodes)
      {
         for (const nodeIndex in subflowInstanceNodes)
         {
            if (subflowInstanceNodes.hasOwnProperty(nodeIndex))
            {
               const node = subflowInstanceNodes[nodeIndex];
               if (node.type === 'loop end' && node.wires[0][0] === loopStartNode.id)
               {
                  found = RED.nodes.getNode(node.id);
               }
               if (found)
               {
                  break;
               }
            }
         }
      }
      else
      {
         // The matching end node is the one node of type 'loop end' with a wire connecting back to the given start node
         // TODO: we should enforce that such a node exists for all loops before the user tries to deploy the flow
         RED.nodes.eachNode(function(node)
         {
            if (node.type === 'loop end' && node.wires[0][0] === loopStartNode.id)
            {
               found = RED.nodes.getNode(node.id);
            }
            if (found)
            {
               return found;
            }
         });
      }
      return found;
   }


   function isAnArrayOfArrays(array)
   {
      let ret = false;
      if (Array.isArray(array) && array.length > 0 && Array.isArray(array[0]))
      {
         ret = true;
      }
      return ret;
   }

   function parameterShouldBeConvertedFromListToScalar(parameter)
   {
      let ret = true;
      if (parameter.isFromConstants())
      {
         ret = false;
      }
      if (!parameter.hasValue())
      {
         ret = false;
      }
      if (parameter.stringValue && parameter.parameterType === 'string')
      {
         ret = false;
      }
      if (parameter.numberValue && parameter.parameterType === 'number')
      {
         ret = false;
      }
      if ((parameter.booleanValue === true || parameter.booleanValue === false) &&
         parameter.parameterType === 'boolean')
      {
         ret = false;
      }
      if (parameter.encodedStringValue && parameter.parameterType === 'encodedString')
      {
         ret = false;
      }
      if (parameter.enumeratedValue && parameter.parameterType === 'enumerated')
      {
         ret = false;
      }
      if (parameter.enumeratedValue && parameter.parameterType === 'json')
      {
         ret = false;
      }
      return ret;
   }

   // Gets a copy of the input parameters flattened out with the values for the specified iteration
   function getInputParamsForCurrentIteration(parameters, iteration)
   {
      const ret = [];
      for (const paramIndex in parameters)
      {
         if (parameters.hasOwnProperty(paramIndex))
         {
            const srcParam = parameters[paramIndex];
            // If it's from constants or a scalar value is defined we leave it as is since it must be a fixed value
            if (!parameterShouldBeConvertedFromListToScalar(srcParam))
            {
               ret.push(srcParam);
            }
            // Else this is a list type and we may need to convert it back into a scalar based on the current iteration
            else
            {
               const destParam =
                  {
                     parameterName: srcParam.parameterName,
                     parameterKey: srcParam.parameterKey,
                     parameterDescription: srcParam.parameterDescription,
                     parameterType: srcParam.parameterType,
                     inputDetails: srcParam.inputDetails
                  };
               let valueIndex;
               switch (destParam.parameterType)
               {
               case 'stringList':
                  // If the input for the loop step contains less values than the number of iterations just
                  // loop back to the begginning of the array
                  valueIndex = iteration % srcParam.stringListValue.length;
                  // If it's a list of scalars, get the value for the iteration
                  if (!isAnArrayOfArrays(srcParam.stringListValue))
                  {
                     destParam.parameterType = 'string';
                     destParam.stringValue =
                        srcParam.stringListValue[valueIndex];
                  }
                  // If it's a list of lists then get the list for the iteration
                  else
                  {
                     destParam.stringListValue = srcParam.stringListValue[valueIndex];
                  }
                  break;
               case 'numberList':
                  // Rinse and repeat...
                  valueIndex = iteration % srcParam.numberListValue.length;
                  if (!isAnArrayOfArrays(srcParam.numberListValue) &&
                     srcParam.numberListValue.length > iteration)
                  {
                     destParam.parameterType = 'number';
                     destParam.numberValue = srcParam.numberListValue[valueIndex];
                  }
                  else
                  {
                     destParam.numberListValue = srcParam.numberListValue[valueIndex];
                  }
                  break;
               case 'booleanList':
                  valueIndex = iteration % srcParam.booleanListValue.length;
                  if (!isAnArrayOfArrays(srcParam.booleanListValue) &&
                     srcParam.booleanListValue.length > iteration)
                  {
                     destParam.parameterType = 'boolean';
                     destParam.booleanValue = srcParam.booleanListValue[valueIndex];
                  }
                  else
                  {
                     destParam.booleanListValue = srcParam.booleanListValue[valueIndex];
                  }
                  break;
               case 'encodedStringList':
                  valueIndex = iteration % srcParam.stringListValue.length;
                  destParam.parameterType = 'encodedString';
                  destParam.encodedStringValue = srcParam.stringListValue[valueIndex];
                  break;
               case 'enumeratedList':
                  valueIndex = iteration % srcParam.stringListValue.length;
                  destParam.parameterType = 'enumerated';
                  destParam.enumeratedValue = srcParam.stringListValue[valueIndex];
                  break;
               default:
                  break;
               }
               ret.push(new Parameter(destParam));
            }
         }
      }
      return ret;
   }

   function LoopStartNode(nodeDefinition)
   {
      this.NodeUtility = new VinoNodeUtility(
         nodeDefinition.name, nodeDefinition.description, nodeDefinition.baseTypes,
         nodeDefinition.selectedBaseType, settingsObject.settings.loopStartCommands.value, [], RED
      );
      RED.nodes.createNode(this, nodeDefinition);
      this.description = nodeDefinition.description;
      this.baseTypes = nodeDefinition.baseTypes;
      this.selectedBaseType = nodeDefinition.selectedBaseType;
      this.statusConfiguration = nodeDefinition.statusConfiguration;
      this.iterationCount = 1;
      this.currentIteration = 0;
      this.inputList = [];
      this.endNode = null;
      this.steps = [];
      const outer = this;

      this.on('input', async function(msg)
      {
         let vinoServiceActivation = null;
         if (msg.vino && msg.vino.serviceActivationId)
         {
            vinoServiceActivation = outer.context().global.vinoServiceActivations[msg.vino.serviceActivationId];
            if (!vinoServiceActivation)
            {
               throw new Error('No valid service activation was found for the ID: ' + msg.vino.serviceActivationId);
            }
            if (vinoServiceActivation.checkForCancellation(outer, msg))
            {
               return;
            }
         }

         try
         {
            utils.debug(`message: ${inspect(msg)}`, outer, msg);
            const inputParams = await outer.NodeUtility.processInputParameters(msg, outer);

            if (!inputParams)
            {
               return;
            }

            for (const paramIndex in inputParams)
            {
               if (outer.selectedBaseType === 'loop' && inputParams[paramIndex].parameterKey === 'iterations')
               {
                  outer.iterationCount = inputParams[paramIndex].numberValue;
                  if (isNaN(outer.iterationCount))
                  {
                     throw new Error('Provided count of iterations was not a valid number');
                  }
               }
               else if (inputParams[paramIndex].parameterKey === 'inputList' &&
                  Array.isArray(inputParams[paramIndex].getValue()))
               {
                  outer.inputList = inputParams[paramIndex].getValue();
                  outer.iterationCount = outer.inputList.length;
               }
            }

            const msgId = msg._msgid; // eslint-disable-line

            // We store the number of iterations in this node's local context keyed by the jobID
            outer.currentIteration = outer.context().get(msgId.replace('.', '')) || 0;

            // Determine what output to send to based on current iteration
            if (outer.currentIteration >= Number(outer.iterationCount))
            {
               outer.status({
                  fill: 'green',
                  shape: 'dot',
                  text: 'Loop completed'
               });
               outer.endNode.status({});
               outer.context().set(msgId.replace('.', ''), 0); // Reset iteration count in case this is a nested loop
               outer.send([null, msg]);
            }
            else
            {
               const outParams = outer.NodeUtility.copyParameters(outer.NodeUtility.getOutputParameters());
               if (outer.selectedBaseType === 'loop')
               {
                  const currentIteration = utils.findParameter(outParams, 'currentIteration');
                  if (currentIteration)
                  {
                     currentIteration.setValue(outer.currentIteration);
                  }
               }
               else
               {
                  const currentValue = utils.findParameter(outParams, 'currentValue');
                  if (currentValue)
                  {
                     currentValue.setValue(outer.inputList[outer.currentIteration]);
                  }
               }

               outer.NodeUtility.processOutputParameters(outParams, outer, msg);
               // Go through every step in this loop, get the input for the current iteration and set the top level
               // input in the activation context so the step can access the current input set while in the loop
               if (vinoServiceActivation)
               {
                  const activationInput = vinoServiceActivation.getStepActivationInput(outer.id);
                  if (activationInput)
                  {
                     for (const stepIndex in activationInput.steps)
                     {
                        if (activationInput.steps.hasOwnProperty(stepIndex))
                        {
                           const step = activationInput.steps[stepIndex];
                           const inputParameters =
                           getInputParamsForCurrentIteration(step.inputParameters, outer.currentIteration);
                           const currentInputStep = {
                              id: step.id,
                              name: step.name,
                              description: step.description,
                              inputParameters: inputParameters
                           };
                           vinoServiceActivation.setStepActivationInput(step.id, currentInputStep);
                        }
                     }
                  }
                  vinoServiceActivation.stepActivated(
                     outer,
                     inputParams,
                     outParams,
                     `Starting loop '${outer.name}' iteration ${outer.currentIteration}`,
                     msg
                  );
               }
               outer.status({
                  fill: 'green',
                  shape: 'ring',
                  text: 'Running Loop. Iteration: ' + outer.currentIteration
               });
               outer.currentIteration += 1;
               outer.context().set(msgId.replace('.', ''), outer.currentIteration);
               outer.send([msg, null]);
            }
         }
         catch (err)
         {
            if (vinoServiceActivation)
            {
               vinoServiceActivation.error(outer, err, msg);
            }
            else
            {
               outer.error(err, msg);
            }
         }
      });

      this.gatherLoopSteps = function(subflowInstanceNodes)
      {
         const endNode = findMatchingEndNode(outer, subflowInstanceNodes);
         if (!endNode)
         {
            throw new Error(`Cannot find matching end node for Loop start with ID ${outer.id}`);
         }
         endNode.startNode = outer;
         outer.endNode = endNode;
         outer.steps = utils.getAllStepsBetweenNodes(RED.nodes.getNode(outer.wires[0][0]), outer.endNode, RED).reverse();
         outer.steps.forEach(function(step)
         {
            step.partOfLoop = true;
         });
      };
   }
   RED.nodes.registerType('loop start', LoopStartNode, settingsObject);
};
