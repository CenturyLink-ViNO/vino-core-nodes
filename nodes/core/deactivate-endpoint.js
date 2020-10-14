/* globals module*/
/* globals require*/
/* globals console*/

const typeorm = require('typeorm');
const ServiceActivation = require('../../../entities/activation/ServiceActivation');
const configStore = require('../lib/configStore/configStore');
module.exports = function(RED)
{
   async function processConfigurationStoreDeactivate(activationData, node, msg, jobId)
   {
      const data = JSON.parse(JSON.stringify(activationData));

      const repository = typeorm.getRepository(ServiceActivation.ServiceActivation);

      const existing = repository.findOne(jobId);
      try
      {
         repository.merge(existing, data);
         await repository.save(existing);
      }
      catch (error)
      {
         console.error(`Error updating configuration store. ${error}`);
      }
   }

   function DeactivationEndNode(nodeDefinition)
   {
      RED.nodes.createNode(this, nodeDefinition);
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
               vinoServiceActivation.completeServiceDeactivation(msg.vino.rollback, msg.vino.deactivationError);
               const activationData = vinoServiceActivation.getActivationData();
               if (msg.vino.rollback)
               {
                  await configStore.processConfigurationStore(activationData, outer, msg, RED);
               }
               else
               {
                  await processConfigurationStoreDeactivate(
                     activationData, outer, msg,
                     vinoServiceActivation.id
                  );
               }
            }
            catch (error)
            {
               console.error(`There was an error while storing activation data for job ${vinoServiceActivation.id} - ${error}`);
            }
            finally
            {
               vinoServiceActivation.removeServiceActivation(outer.context());
            }
         }
      });
   }

   RED.nodes.registerType('deactivation endpoint', DeactivationEndNode);
};
