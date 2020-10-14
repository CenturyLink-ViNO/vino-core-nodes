/* globals console */
/* globals require*/
/* globals module*/

const typeorm = require('typeorm');
const ServiceActivation = require('../../../../entities/activation/ServiceActivation');
const Parameter = require('vino-node-red-nodes/lib/driver-utils').Parameter;

function minimizeActivationTemplate(activationTemplate)
{
   const steps = [];
   activationTemplate.steps.forEach(function(step)
   {
      const inputParameters = [];
      step.inputParameters.forEach(function(inputParameter)
      {
         parameter = new Parameter(inputParameter);
         if (parameter.hasValue())
         {
            delete parameter.parameterName;
            delete parameter.parameterDescription;
            delete parameter.inputDetails;
            inputParameters.push(parameter);
         }
      });
      step.inputParameters = inputParameters;
      if (step.inputParameters.length > 0)
      {
         steps.push(step);
      }
   });
   activationTemplate.steps = steps;
   return activationTemplate;
}


module.exports = {
   processConfigurationStore: async function(activationData, node, msg)
   {
      const data = JSON.parse(JSON.stringify(activationData));
      delete data.activatedSteps;
      data.steps = [];
      if (activationData.activatedSteps)
      {
         let key;
         for (key in activationData.activatedSteps)
         {
            if (activationData.activatedSteps.hasOwnProperty(key))
            {
               const step = activationData.activatedSteps[key];
               let entry;
               for (entry in step)
               {
                  if (step.hasOwnProperty(entry))
                  {
                     const substep = step[entry];
                     const inputs = [];
                     const outputs = [];
                     // Convert input an output parameters from objects into lists
                     let parameter;
                     for (parameter in substep.inputParameters)
                     {
                        if (substep.inputParameters.hasOwnProperty(parameter))
                        {
                           inputs.push(substep.inputParameters[parameter]);
                        }
                     }
                     for (parameter in substep.outputParameters)
                     {
                        if (substep.outputParameters.hasOwnProperty(parameter))
                        {
                           outputs.push(substep.outputParameters[parameter]);
                        }
                     }
                     substep.inputParameters = inputs;
                     substep.outputParameters = outputs;
                  }
               }
               data.steps.push({
                  nodeId: key,
                  steps: step
               });
            }
         }
      }
      if (node.uri[0] !== '/')
      {
         node.uri = '/' + node.uri;
      }
      delete msg.vino;
      data.msg = msg;
      data.inputTemplate = minimizeActivationTemplate(data.inputTemplate);

      const repository = typeorm.getRepository(ServiceActivation.ServiceActivation);
      const activation = repository.create(data);

      try
      {
         await repository.save(activation);
      }
      catch (error)
      {
         console.error(`Error saving service activation data. ${error}`);
      }
   }
};
