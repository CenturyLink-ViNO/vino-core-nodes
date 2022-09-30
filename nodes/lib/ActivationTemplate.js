/* globals module */
/* globals require */
/* eslint strict: ["off", "function"] */
const Parameter = require('vino-node-red-nodes/lib/driver-utils').Parameter;

const processInputParametersForStep = function(step, nodeParams, includeAll)
{
   if (includeAll)
   {
      step.inputParameters = step.inputParameters.concat(nodeParams);
   }
   else
   {
      nodeParams.forEach(function(param)
      {
         if (param.isFromMappedParam())
         {
            return;
         }
         if (param.isFromConstants() && !param.inputDetails.constantsPath.startsWith('/'))
         {
            step.settingsRootRequired = true;
         }
         if (param.isFinal())
         {
            return;
         }
         step.inputParameters.push(param);
      });
   }
};

// For Loop steps we map all activation time scalar params to list params of the matching types. The loop start node
// is then responsible for converting back to scalars and using the correct value per iteration during activation
const processInputParametersForLoopStep = function(step, nodeParams)
{
   const stepParams = step.inputParameters;
   nodeParams.forEach(function(param)
   {
      if (param.isFromMappedParam())
      {
         return;
      }
      if (param.isFromConstants() && !param.inputDetails.constantsPath.startsWith('/'))
      {
         step.settingsRootRequired = true;
      }
      if (param.isFinal())
      {
         return;
      }
      const destParam = new Parameter(param);

      destParam.isNestedList = false;
      switch (param.parameterType)
      {
      case 'string':
         destParam.parameterType = 'stringList';
         stepParams.push(destParam);
         break;
      case 'number':
         destParam.parameterType = 'numberList';
         stepParams.push(destParam);
         break;
      case 'boolean':
         destParam.parameterType = 'booleanList';
         stepParams.push(destParam);
         break;
      case 'encodedString':
         destParam.parameterType = 'encodedStringList';
         stepParams.push(destParam);
         break;
      case 'enumerated':
         destParam.parameterType = 'enumeratedList';
         stepParams.push(destParam);
         break;
      case 'stringList':
      case 'numberList':
      case 'booleanList':
         // The expectation with lists is that the listValue will become a list of lists of the specified type
         // e.g. stringListValue: [ ['foo', 'bar'], ['baz', 'qux'] ]
         destParam.isNestedList = true;
         stepParams.push(destParam);
         break;
      default:
         break;
      }
      if (param.hasValue())
      {
         const arrayValue = [];
         arrayValue.push(param.getValue());
         destParam.setValue(arrayValue);
      }
   });
};

let processConditionalNodeForTemplate = null;
let processLoopNodeForTemplate = null;
const processSubNode = function(node, visited = [])
{
   if (!node)
   {
      throw new Error('Invalid node');
   }
   let subStep;
   if (visited.indexOf(node) === -1)
   {
      switch (node.type)
      {
      case 'loop start':
         subStep = processLoopNodeForTemplate(node, visited);
         break;
      case 'conditional start':
         // Since input parameters are changed to lists for loop steps we need to check if the conditional is
         // nested within a loop and perform the parameter processesing accordingly.
         subStep = processConditionalNodeForTemplate(node, visited, node.partOfLoop);
         break;
      default:
         subStep = {
            id: node.id,
            name: node.name,
            description: node.description,
            type: node.type,
            settingsRootRequired: false,
            inputParameters: []
         };
      }
   }
   visited.push(node);
   return subStep;
};

processLoopNodeForTemplate = function(node, visited)
{
   if (!node)
   {
      throw new Error('Invalid node');
   }
   const step = {
      id: node.id,
      name: node.name,
      description: node.description,
      type: node.type,
      settingsRootRequired: false,
      inputParameters: [],
      steps: []
   };
   node.steps.forEach(function(loopBodyNode)
   {
      const subStep = processSubNode(loopBodyNode, visited);
      if (subStep && loopBodyNode.NodeUtility && loopBodyNode.NodeUtility.getInputParameters())
      {
         processInputParametersForLoopStep(
            subStep,
            loopBodyNode.NodeUtility.getInputParameters()
         );
         step.steps.push(subStep);
      }
      if (subStep && subStep.settingsRootRequired)
      {
         step.settingsRootRequired = true;
      }
   });
   return step;
};

processConditionalNodeForTemplate = function(node, visited, nestedInLoop)
{
   if (!node)
   {
      throw new Error('Invalid node');
   }
   const step = {
      id: node.id,
      name: node.name,
      description: node.description,
      type: node.type,
      settingsRootRequired: false,
      inputParameters: [],
      falseSteps: [],
      trueSteps: []
   };
   node.falseSteps.forEach(function(conditionalBodyNode)
   {
      const subStep = processSubNode(conditionalBodyNode, visited);
      if (subStep && conditionalBodyNode.NodeUtility && conditionalBodyNode.NodeUtility.getInputParameters())
      {
         if (nestedInLoop)
         {
            processInputParametersForLoopStep(
               subStep,
               conditionalBodyNode.NodeUtility.getInputParameters()
            );
         }
         else
         {
            processInputParametersForStep(
               subStep,
               conditionalBodyNode.NodeUtility.getInputParameters()
            );
         }
         step.falseSteps.push(subStep);
      }
      if (subStep && subStep.settingsRootRequired)
      {
         step.settingsRootRequired = true;
      }
   });
   node.trueSteps.forEach(function(conditionalBodyNode)
   {
      const subStep = processSubNode(conditionalBodyNode, visited);
      if (subStep && conditionalBodyNode.NodeUtility && conditionalBodyNode.NodeUtility.getInputParameters())
      {
         if (nestedInLoop)
         {
            processInputParametersForLoopStep(
               subStep,
               conditionalBodyNode.NodeUtility.getInputParameters()
            );
         }
         else
         {
            processInputParametersForStep(
               subStep,
               conditionalBodyNode.NodeUtility.getInputParameters()
            );
         }
         step.trueSteps.push(subStep);
      }
      if (subStep && subStep.settingsRootRequired)
      {
         step.settingsRootRequired = true;
      }
   });
   return step;
};

const processNodeForTemplate = function(subNode, template, RED, visited = [])
{
   if (visited.indexOf(subNode) === -1)
   {
      const step = processSubNode(subNode, visited);
      if (step && subNode.NodeUtility && subNode.NodeUtility.getInputParameters())
      {
         const includeAll = step.type === 'conditional start' || step.type === 'loop start';
         processInputParametersForStep(step, subNode.NodeUtility.getInputParameters(), includeAll);
         template.steps.push(step);
      }
      if (step.settingsRootRequired)
      {
         template.settingsRootRequired = true;
      }
   }
};

module.exports =
   {
      getActivationTemplate: function(serviceStartNode, RED)
      {
         if (!serviceStartNode || serviceStartNode.type !== 'service entrypoint')
         {
            throw new Error('Invalid start node');
         }
         const template = {
            serviceName: serviceStartNode.name,
            customerName: '',
            isUsFederalCustomer: false,
            settingsRootGroup: '',
            settingsRootRequired: false,
            debug: false,
            steps: []
         };
         // Make sure we have the latest version of the node
         const node = RED.nodes.getNode(serviceStartNode.id);
         const processedNodes = [];
         if (Array.isArray(node.wires))
         {
            node.activationSteps.forEach(function(step)
            {
               processNodeForTemplate(step, template, RED, processedNodes);
            });
         }
         return template;
      }
   };
