/* globals module*/
/* globals require*/

const NodeUtilities = require('../lib/driver-utils/index');
const Parameter = NodeUtilities.Parameter;
const VinoNodeUtility = NodeUtilities.VinoNodeUtility;
module.exports = function(RED)
{
   function constructMsgObject(msg, inputParams)
   {
      inputParams.forEach(function(inputParam)
      {
         msg[inputParam.parameterKey] = inputParam.getValue();
      });
   }

   function resolveOutputParamsFromMsg(node, msg)
   {
      const outputParams = [];
      let out;
      node.NodeUtility.getOutputParameters().forEach(function(param)
      {
         out = new Parameter(param);
         if (msg.hasOwnProperty(param.parameterKey))
         {
            out.setValue(msg[param.parameterKey]);
         }
         else
         {
            const payload = msg.payload;
            if (typeof payload === 'object')
            {
               if (payload.hasOwnProperty(param.parameterKey))
               {
                  out.setValue(payload[param.parameterKey]);
               }
            }
            else if (typeof payload === 'string')
            {
               let regex;
               let matches;
               switch (param.outputDetails.type.toLowerCase())
               {
               case 'regex':
                  regex = new RegExp(param.outputDetails.format);
                  matches = payload.match(regex);
                  if (matches.length > 0)
                  {
                     out.setValue(matches[0]);
                  }
                  break;
               case 'jsonpath':
               case 'xpath':
               case 'custom':
               default:
               // TODO
               }
            }
         }
         outputParams.push(out);
      });
      return outputParams;
   }
   function combineParams(params, type)
   {
      const ret = [];

      let val;
      params.forEach(function(param)
      {
         val = param.getValue();
         switch (type.toLowerCase())
         {
         case 'string':
            ret.push(String(val));
            break;
         case 'number':
            val = Number(val);
            if (isNaN(val))
            {
               throw new Error(`Error casting input parameter '${param.parameterName}' to a number. Value ${param.getValue()}`);
            }
            ret.push(Number(param.getValue()));
            break;
         case 'boolean':
            if (typeof val === 'boolean')
            {
               ret.push(val);
            }
            else if (val.toLowerCase() === 'false')
            {
               ret.push(false);
            }
            else if (val.toLowerCase() === 'true')
            {
               ret.push(true);
            }
            else
            {
               throw new Error(`Error casting input parameter '${param.parameterName}' to a boolean. Value ${param.getValue()}`);
            }
            break;
         default:
            throw new Error('Invalid type');
         }
      });
      return ret;
   }
   function ParameterWrapper(nodeDefinition)
   {
      RED.nodes.createNode(this, nodeDefinition);
      this.description = nodeDefinition.description;
      this.baseTypes = nodeDefinition.baseTypes;
      this.selectedBaseType = nodeDefinition.selectedBaseType;
      this.statusConfiguration = nodeDefinition.statusConfiguration;
      this.NodeUtility = new VinoNodeUtility(
         nodeDefinition.name, nodeDefinition.description, nodeDefinition.baseTypes,
         nodeDefinition.selectedBaseType, RED
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
            let outputParams = [];

            let output;
            switch (outer.selectedBaseType)
            {
            case 'parameter_wrapper':
               constructMsgObject(msg, inputParams);
               outputParams = resolveOutputParamsFromMsg(outer, msg);
               break;
            case 'parameter_combiner_string':
               output = combineParams(inputParams, 'string');
               if (output)
               {
                  outputParams.push(new Parameter({
                     parameterName: 'Combined Output',
                     parameterKey: 'combined_output',
                     parameterType: 'stringList',
                     parameterDescription: 'A single list of all provided input parameters.',
                     stringListValue: output,
                     outputDetails: {
                        type: 'CUSTOM',
                        format: ''
                     }
                  }));
               }
               break;
            case 'parameter_combiner_number':
               output = combineParams(inputParams, 'number');
               if (output)
               {
                  outputParams.push(new Parameter({
                     parameterName: 'Combined Output',
                     parameterKey: 'combined_output',
                     parameterType: 'numberList',
                     parameterDescription: 'A single list of all provided input parameters.',
                     numberListValue: output,
                     outputDetails: {
                        type: 'CUSTOM',
                        format: ''
                     }
                  }));
               }
               break;
            case 'parameter_combiner_boolean':
               output = combineParams(inputParams, 'boolean');
               if (output)
               {
                  outputParams.push(new Parameter({
                     parameterName: 'Combined Output',
                     parameterKey: 'combined_output',
                     parameterType: 'booleanList',
                     parameterDescription: 'A single list of all provided input parameters.',
                     booleanListValue: output,
                     outputDetails: {
                        type: 'CUSTOM',
                        format: ''
                     }
                  }));
               }
               break;
            default:
               break;
            }
            outer.NodeUtility.processOutputParameters(outputParams, outer, msg);
            if (vinoServiceActivation)
            {
               vinoServiceActivation.stepActivated(outer, inputParams, outputParams, null, msg);
            }
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
         parameterWrapperCommands: {
            value: [
               {
                  name: 'Parameter Injection/Extraction',
                  key: 'parameter_wrapper',
                  description: 'Injects any input parameters into the Node-Red msg object and attempts to extract any' +
                     'output parameters from the msg object with a matching key',
                  inputParameters:
                     [],
                  outputParameters:
                     []
               },
               {
                  name: 'Parameter Combiner (String)',
                  key: 'parameter_combiner_string',
                  description: 'Combines any input parameters into a string list type output',
                  inputParameters:
                     [],
                  outputParameters:
                     [
                        {
                           parameterName: 'Combined Output',
                           parameterKey: 'combined_output',
                           parameterDescription: 'A single list of all provided input parameters',
                           parameterType: 'stringList',
                           outputDetails:
                              {
                                 type: 'CUSTOM',
                                 format: 'unused'
                              }
                        }
                     ]
               },
               {
                  name: 'Parameter Combiner (Number)',
                  key: 'parameter_combiner_number',
                  description: 'Combines any input parameters into a string list type output',
                  inputParameters:
                     [],
                  outputParameters:
                     [
                        {
                           parameterName: 'Combined Output',
                           parameterKey: 'combined_output',
                           parameterDescription: 'A single list of all provided input parameters',
                           parameterType: 'numberList',
                           outputDetails:
                              {
                                 type: 'CUSTOM',
                                 format: 'unused'
                              }
                        }
                     ]
               },
               {
                  name: 'Parameter Combiner (Boolean)',
                  key: 'parameter_combiner_boolean',
                  description: 'Combines any input parameters into a string list type output',
                  inputParameters:
                     [],
                  outputParameters:
                     [
                        {
                           parameterName: 'Combined Output',
                           parameterKey: 'combined_output',
                           parameterDescription: 'A single list of all provided input parameters',
                           parameterType: 'booleanList',
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

   RED.nodes.registerType('parameter wrapper', ParameterWrapper, settingsObject);
};
