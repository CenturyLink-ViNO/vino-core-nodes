/* globals module*/
/* globals require*/
/* globals module */

const NodeUtilities = require('../lib/driver-utils/index');
module.exports = function(RED)
{
   const utils = NodeUtilities.Utils;
   const VinoNodeUtility = NodeUtilities.VinoNodeUtility;

   function ThrowNode(nodeDefinition)
   {
      RED.nodes.createNode(this, nodeDefinition);
      this.message = nodeDefinition.message;
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

            if (!inputParams)
            {
               return;
            }

            const message = utils.fillTemplate(outer.message, inputParams, msg);
            if (vinoServiceActivation)
            {
               vinoServiceActivation.setStatus('Error', message, outer);
            }
            if (vinoServiceActivation)
            {
               vinoServiceActivation.error(outer, message, msg);
            }
            else
            {
               utils.error(message, outer, msg);
               outer.error(message, msg);
            }
         }
         catch (err)
         {
            outer.error(outer.message, msg);
         }
      });
   }

   const settingsObject = {
      settings: {
         throwCommands: {
            value: [
               {
                  name: 'throw error',
                  key: 'throw_error',
                  description: 'Throws an error and prints a message',
                  allowedExtractionMethods: ['CUSTOM'],
                  inputParameters:
                     [],
                  outputParameters:
                     []
               }
            ],
            exportable: true
         }
      }
   };
   RED.nodes.registerType('throw', ThrowNode, settingsObject);
};
