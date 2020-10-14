const ConditionalStartConfig = require('./core/config/conditional-start');
const LoopStartConfig = require('./core/config/loop-start');
const ParameterWrappoerConfig = require('./core/config/parameter-wrapper');
const StatusConfig = require('./core/config/status');
const ThrowConfig = require('./core/config/throw');

module.exports =  {
   types: ['conditional start', 'loop start', 'parameter wrapper', 'service status', 'throw'],
   config: {
      'conditional start': { configCommands: ConditionalStartConfig.settings.conditionalStartCommands, commonParameters: [] },
      'loop start': { configCommands: LoopStartConfig.settings.loopStartCommands, commonParameters: [] },
      'parameter wrapper': { configCommands: ParameterWrappoerConfig.settings.parameterWrapperCommands, commonParameters: [] },
      'service status': { configCommands: StatusConfig.settings.serviceStatusCommands, commonParameters: [] },
      'throw': { configCommands: ThrowConfig.settings.throwCommands, commonParameters: [] }
   }
};