/* globals module*/
/* globals require*/
/* globals module */

const NodeUtilities = require('vino-node-red-nodes/lib/driver-utils');
const settingsObject = require('./config/throw');
const inspect = require('util').inspect;
module.exports = function(RED)
{
   const utils = NodeUtilities.Utils;
   const VinoNodeUtility = NodeUtilities.VinoNodeUtility;

   function ThrowNode(nodeDefinition)
   {
      this.NodeUtility = new VinoNodeUtility(
         nodeDefinition.name, nodeDefinition.description,
         nodeDefinition.baseTypes, nodeDefinition.selectedBaseType,
         settingsObject.settings.throwCommands.value, [], RED
      );
      RED.nodes.createNode(this, nodeDefinition);
      this.message = nodeDefinition.message;

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
   RED.nodes.registerType('throw', ThrowNode, settingsObject);
};
