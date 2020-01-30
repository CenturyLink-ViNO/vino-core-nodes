/* globals module*/
/* globals require*/

const Parameter = require('../lib/driver-utils/parameter');

module.exports = function(RED)
{
   function gatherOutputParams(serviceActivation, outputParams, conditionalResult, conditionalIsWithinLoop)
   {
      const resolvedParams = [];
      let out;
      let found;
      if (outputParams && Array.isArray(outputParams))
      {
         for (const paramIndex in outputParams)
         {
            if (outputParams.hasOwnProperty(paramIndex))
            {
               const param = outputParams[paramIndex];
               let mappedFrom;
               if (!param.inputDetails || !param.inputDetails.conditionalMappedFrom)
               {
                  return false;
               }

               if (conditionalResult)
               {
                  mappedFrom = param.inputDetails.conditionalMappedFrom.trueMapping;
               }
               else
               {
                  mappedFrom = param.inputDetails.conditionalMappedFrom.falseMapping;
               }
               let iteration;
               if (!conditionalIsWithinLoop)
               {
                  iteration = 0;
               }
               found = serviceActivation.getOutputParameter(mappedFrom.nodeId, mappedFrom.key, iteration) ||
               serviceActivation.getInputParameter(mappedFrom.nodeId, mappedFrom.key, iteration);
               if (found)
               {
                  out = new Parameter(param);
                  out.setValue(found.getValue());
                  resolvedParams.push(out);
                  break;
               }
               if (!found)
               {
                  return false;
               }
            }
         }
      }
      return resolvedParams;
   }

   function ConditionalEndNode(nodeDefinition)
   {
      RED.nodes.createNode(this, nodeDefinition);
      this.startNode = null; // To be populated by start node at beginning of conditional
      this.outputParams = [];
      this.description = nodeDefinition.description;
      const outer = this;
      if (nodeDefinition.outputParameters && Array.isArray(nodeDefinition.outputParameters))
      {
         nodeDefinition.outputParameters.forEach(function(param)
         {
            outer.outputParams.push(new Parameter(param));
         });
      }


      this.on('input', function(msg)
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

            let resolvedOutputParams = true;

            resolvedOutputParams = gatherOutputParams(vinoServiceActivation, outer.outputParams, outer.startNode.evaluation, outer.partOfLoop);

            if (!resolvedOutputParams)
            {
               if (outer.isDeactivationNode)
               {
                  outer.send(msg);
               }
               else
               {
                  outer.error('Could not resolve output parameter in conditional end node', msg);
               }
            }

            vinoServiceActivation.stepActivated(outer, [], resolvedOutputParams, null, msg);
         }
         outer.send(msg);
      });

      this.on('close', function()
      {
         // intentionally left blank
      });
   }

   RED.nodes.registerType('conditional end', ConditionalEndNode);
};
