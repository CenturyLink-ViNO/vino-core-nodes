/* globals module*/
/* globals require*/

const NodeUtilities = require('vino-node-red-nodes/lib/driver-utils');

module.exports = function(RED)
{
   function StatusNode(nodeDefinition)
   {
      const utils = NodeUtilities.Utils;
      const VinoNodeUtility = NodeUtilities.VinoNodeUtility;
      RED.nodes.createNode(this, nodeDefinition);
      this.description = nodeDefinition.description;
      this.baseTypes = nodeDefinition.baseTypes;
      this.selectedBaseType = nodeDefinition.selectedBaseType;
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


            const message = utils.fillTemplate(outer.message, inputParams, msg);
            if (vinoServiceActivation)
            {
               vinoServiceActivation.setStatus('Activating', message, outer);
            }
            utils.log(message, outer, msg);
            outer.status({
               fill: 'green',
               shape: 'dot',
               text: message
            });
            outer.send(msg);
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
   }

   const settingsObject = {
      settings: {
         serviceStatusCommands: {
            value: [
               {
                  name: 'service status',
                  key: 'service_status',
                  description: 'Outputs a message to the service activation status',
                  allowedExtractionMethods: ['CUSTOM'],
                  inputParameters: [],
                  outputParameters: []
               }
            ],
            exportable: true
         }
      }
   };

   RED.nodes.registerType('service status', StatusNode, settingsObject);
};
