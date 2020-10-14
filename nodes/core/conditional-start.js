/* globals module*/
/* globals require*/


const NodeUtilities = require('vino-node-red-nodes/lib/driver-utils');
const Parameter = NodeUtilities.Parameter;
module.exports = function(RED)
{
   const utils = NodeUtilities.Utils;
   const VinoNodeUtility = NodeUtilities.VinoNodeUtility;

   const opMap = {
      'eq': '=',
      'gt': '>',
      'lt': '<',
      'gte': '>=',
      'lte': '<='
   };

   function findMatchingEndNode(startNode, subConditionalCount)
   {
      let found = null;
      let count = subConditionalCount;
      // If we encounter another condtional start then we need to remember to ignore its corresponding end node
      if (startNode.type === 'conditional start')
      {
         count += 1;
      }
      // We hit a conditional end, but not the one we're interested in (i.e. there's a nested conditional)
      if (startNode.type === 'conditional end')
      {
         if (count > 0)
         {
            count -= 1;
         }
         else
         {
            return startNode;
         }
      }
      for (const outputIndex in startNode.wires)
      {
         if (startNode.wires.hasOwnProperty(outputIndex))
         {
            for (const wireIndex in startNode.wires[outputIndex])
            {
               if (startNode.wires[outputIndex].hasOwnProperty(wireIndex))
               {
                  const next = RED.nodes.getNode(startNode.wires[outputIndex][wireIndex]);
                  if (next.type === 'conditional end' && count === 0)
                  {
                     return next;
                  }
                  else if (next.type !== 'loop end')
                  {
                     found = findMatchingEndNode(next, count);
                  }
               }
            }
         }
      }
      return found;
   }

   function performCondition(lhs, rhs, operation)
   {
      let error;
      switch (operation)
      {
      case 'eq':
         return lhs === rhs;
      case 'gt':
         if (typeof lhs === 'number' && typeof rhs === 'number')
         {
            return lhs > rhs;
         }
         error = 'One or more operands is not a number';
         break;
      case 'gte':
         if (typeof lhs === 'number' && typeof rhs === 'number')
         {
            return lhs >= rhs;
         }
         error = 'One or more operands is not a number';
         break;
      case 'lt':
         if (typeof lhs === 'number' && typeof rhs === 'number')
         {
            return lhs < rhs;
         }
         error = 'One or more operands is not a number';
         break;
      case 'lte':
         if (typeof lhs === 'number' && typeof rhs === 'number')
         {
            return lhs <= rhs;
         }
         error = 'One or more operands is not a number';
         break;
      default:
         error = 'Invalid operation';
      }
      throw new Error(error);
   }

   function ConditionalStartNode(nodeDefinition)
   {
      RED.nodes.createNode(this, nodeDefinition);
      this.description = nodeDefinition.description;
      this.baseTypes = nodeDefinition.baseTypes;
      this.selectedBaseType = nodeDefinition.selectedBaseType;
      this.statusConfiguration = nodeDefinition.statusConfiguration;
      this.endNode = null;
      this.trueSteps = [];
      this.falseSteps = [];
      this.evaluation = null;
      this.NodeUtility = new VinoNodeUtility(
         nodeDefinition.name, nodeDefinition.description,
         nodeDefinition.baseTypes, nodeDefinition.selectedBaseType, RED
      );
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
            const inputParams = await outer.NodeUtility.processInputParameters(msg, outer);
            const outputParams = [];

            let lhs = utils.findParameter(inputParams, 'lhs');
            let rhs = utils.findParameter(inputParams, 'rhs');
            const operation = utils.findParameter(inputParams, 'op');
            const dataType = utils.findParameter(inputParams, 'dataType');

            switch (dataType.getValue())
            {
            case 'string':
               lhs = lhs.stringValue;
               rhs = rhs.stringValue;
               break;
            case 'number':
               lhs = Number(lhs.stringValue);
               rhs = Number(rhs.stringValue);
               if (isNaN(lhs) || isNaN(rhs))
               {
                  throw new Error('One or both of the operands is not a valid number');
               }
               break;
            case 'boolean':
               lhs = lhs.stringValue === 'true';
               rhs = rhs.stringValue === 'true';
               break;
            default:
               throw new Error(`${dataType} is not a valid datatype. Must be 'string', 'number', or 'boolean'`);
            }
            const opSymbol = opMap[operation.getValue()];
            utils.debug(`Evaluating conditional ${lhs} ${opSymbol} ${rhs}`, outer, msg);
            outer.evaluation = performCondition(lhs, rhs, operation.getValue());

            outputParams.push(new Parameter({
               parameterName: 'Evaluation Result',
               parameterKey: 'result',
               parameterType: 'boolean',
               parameterDescription: 'The result of the conditional evaluation.',
               booleanValue: outer.evaluation,
               outputDetails: {
                  type: 'CUSTOM',
                  format: ''
               }
            }));

            outer.NodeUtility.processOutputParameters(outputParams, outer, msg);

            if (vinoServiceActivation)
            {
               vinoServiceActivation.stepActivated(outer, inputParams, outputParams, null, msg);
            }
            if (outer.evaluation)
            {
               outer.status({
                  fill: 'green',
                  shape: 'dot',
                  text: 'Condition evaluated true'
               });
               outer.send([null, msg]);
            }
            else
            {
               outer.status({
                  fill: 'green',
                  shape: 'dot',
                  text: 'Condition evaluated false'
               });
               outer.send([msg, null]);
            }
         }
         catch (err)
         {
            if (vinoServiceActivation)
            {
               vinoServiceActivation.error(outer, 'Error evaluating conditional. ' + err, msg);
            }
            else
            {
               outer.error();
            }
         }
      });

      // We need to make sure we always have the end loop node and list of steps available and updated after deploy
      // Using this event works for now
      this.gatherConditionalSteps = function()
      {
         let output;
         let wire;
         let endNode;
         for (let wireIndex = 0; wireIndex < outer.wires.length; wireIndex = wireIndex + 1)
         {
            output = outer.wires[wireIndex];
            for (let outputIndex = 0; outputIndex < output.length; outputIndex = outputIndex + 1)
            {
               wire = output[outputIndex];
               const startNode = RED.nodes.getNode(wire);
               endNode = findMatchingEndNode(startNode, 0);
               if (endNode)
               {
                  break;
               }
            }
            if (endNode)
            {
               break;
            }
         }
         if (endNode === null)
         {
            throw new Error('Cannot find matching end node for Conditional start node');
         }
         endNode.startNode = outer;
         outer.endNode = endNode;
         outer.falseSteps = utils.getAllStepsBetweenNodes(RED.nodes.getNode(outer.wires[0][0]), outer.endNode, RED).
            reverse();
         outer.trueSteps = utils.getAllStepsBetweenNodes(RED.nodes.getNode(outer.wires[1][0]), outer.endNode, RED).
            reverse();
         outer.falseSteps.forEach(function(step)
         {
            step.partOfConditional = true;
            step.conditionalStartId = outer.id;
         });
         outer.trueSteps.forEach(function(step)
         {
            step.partOfConditional = true;
            step.conditionalStartId = outer.id;
         });
      };
   }

   const settingsObject = {
      settings: {
         conditionalStartCommands: {
            value: [
               {
                  name: 'Conditional',
                  key: 'conditional',
                  description: 'Used branch between 2 paths based on a condition',
                  allowedExtractionMethods: ['CUSTOM'],
                  inputParameters:
                     [
                        {
                           parameterName: 'Left Hand Side',
                           parameterKey: 'lhs',
                           parameterDescription: 'The left hand operand',
                           parameterType: 'string'
                        },
                        {
                           parameterName: 'Right Hand Side',
                           parameterKey: 'rhs',
                           parameterDescription: 'The right hand operand',
                           parameterType: 'string'
                        },
                        {
                           parameterName: 'Operation',
                           parameterKey: 'op',
                           parameterDescription: 'The comparison operation to perform.',
                           parameterType: 'enumerated',
                           inputDetails:
                              { options: ['eq', 'gt', 'gte', 'lt', 'lte'] }
                        },
                        {
                           parameterName: 'Operand Data Type',
                           parameterKey: 'dataType',
                           parameterDescription: 'The data type of the two operands. Valid options are "string", "number", or "boolean"',
                           parameterType: 'enumerated',
                           inputDetails:
                              { options: ['string', 'number', 'boolean'] }
                        }
                     ],
                  outputParameters:
                     [
                        {
                           parameterName: 'Evaluation Result',
                           parameterKey: 'result',
                           parameterDescription: 'The result of the conditional evaluation',
                           parameterType: 'boolean',
                           outputDetails:
                              {
                                 type: 'CUSTOM',
                                 format: 'unused'
                              }
                        }
                     ]
               }
            ],
            exportable: true
         }
      }
   };
   RED.nodes.registerType('conditional start', ConditionalStartNode, settingsObject);
};
