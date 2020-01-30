/* globals module*/
/* globals require*/
/* globals console*/
const configStore = require('../lib/configStore/configStore');
module.exports = function(RED)
{
   function ServiceEndNode(nodeDefinition)
   {
      RED.nodes.createNode(this, nodeDefinition);
      this.uri = nodeDefinition.uri;
      const outer = this;

      this.on('input', async function(msg)
      {
         if (msg.vino && msg.vino.serviceActivationId)
         {
            // Check one last time that service wasn't canceled
            const serviceActivation = outer.context().global.vinoServiceActivations[msg.vino.serviceActivationId];
            if (!serviceActivation)
            {
               throw new Error('No valid service activation was found for the ID: ' + msg.vino.serviceActivationId);
            }
            if (serviceActivation && serviceActivation.cancel)
            {
               serviceActivation.setStatus('Cancelled', 'Service activation successfully cancelled', outer);
               outer.error('Service Activation Cancelled', msg);
               return;
            }
            try
            {
               serviceActivation.completeServiceActivation();
               await configStore.processConfigurationStore(serviceActivation, outer, msg);
            }
            catch (error)
            {
               console.error(`There was an error while storing activation data for job ${serviceActivation.id} - ${error}`);
            }
            finally
            {
               serviceActivation.removeServiceActivation(outer.context());
            }
         }
      });
   }

   RED.nodes.registerType('service endpoint', ServiceEndNode);
};
