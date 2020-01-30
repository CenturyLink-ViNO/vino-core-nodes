/* globals module*/
/* globals require*/
/* globals console*/
const configStore = require('../lib/configStore/configStore');
const NodeUtilities = require('../lib/driver-utils/index');

module.exports = function(RED)
{
   function ServiceFailNode(nodeDefinition)
   {
      RED.nodes.createNode(this, nodeDefinition);
      const utils = NodeUtilities.Utils;
      this.uri = nodeDefinition.uri;
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
            try
            {
               const activationData = vinoServiceActivation.getActivationData();
               if (msg.vino.rollback || msg.vino.deactivate)
               {
                  // Something threw an error in the rollback/deactivate flow after the service fail node was
                  // already hit. That shouldn't happen but if it does this check will prevent infinite recursion
                  vinoServiceActivation.setStatus('Failed', 'An unexpected error occurred while deactivating' +
                     'or rolling back. Service may be in an inconsistent state.', outer);
                  utils.error('Fatal Error. Hit service failure node after deactivate or rollback started. Aborting...', outer, msg);
                  await configStore.processConfigurationStore(activationData, outer, msg, RED);
                  vinoServiceActivation.removeServiceActivation(outer.context());
                  return;
               }
               if (outer.wires[0].length > 0)
               {
                  vinoServiceActivation.failServiceActivation(msg.vino.cancelled, true);
                  vinoServiceActivation.setStatus('Activating', 'Rolling back', outer);
                  utils.log('Service encountered a failure. Beginning service rollback', outer, msg);
                  msg.vino.rollback = true;
                  outer.send(msg);
               }
               else
               {
                  vinoServiceActivation.failServiceActivation(msg.vino.cancelled);
                  utils.log('Service encountered a failure. No Rollback nodes present.', outer, msg);
                  await configStore.processConfigurationStore(activationData, outer, msg, RED);
                  vinoServiceActivation.removeServiceActivation(outer.context());
               }
            }
            catch (error)
            {
               console.error(`There was an error while storing activation data for job ${vinoServiceActivation.id} - ${error}`);
               // node.error(`There was an error while storing activation data - ${error}`, msg);
               vinoServiceActivation.removeServiceActivation(outer.context());
            }
         }
         else
         {
            // If not a vino service activation then just pass
            outer.send(msg);
         }
      });
   }

   RED.nodes.registerType('service failure', ServiceFailNode);
};
