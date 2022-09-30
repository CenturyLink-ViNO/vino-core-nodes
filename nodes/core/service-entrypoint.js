/* globals module*/
/* globals require*/
/* globals console*/
const utils = require('vino-node-red-nodes/lib/driver-utils').Utils;
const VinoServiceActivation = require('../lib/VinoServiceActivation');
const ActivationTemplate = require('../lib/ActivationTemplate');
const ServiceRegistration = require('../../../entities/ServiceRegistration').ServiceRegistration;
const ServiceActivation = require('../../../entities/activation/ServiceActivation').ServiceActivation;
const StepWrapper = require('../../../entities/activation/StepWrapper').StepWrapper;
const RootGroup = require('../../../entities/settings/rootGroup').RootGroup;
const settingsUtils = require('../../../routes/services/utility/settingsUtility');
const SettingUtilities = new settingsUtils.SettingsUtility();
const typeorm = require('typeorm');
module.exports = function(RED)
{
   async function registerService(node)
   {
      const repository = typeorm.getRepository(ServiceRegistration);
      const registration = repository.create({
         id: node.serviceRegistrationId,
         name: node.name,
         description: node.description,
         entryNodeId: node.id
      });
      try
      {
         await repository.save(registration);
         node.log(`Registered service with id ${node.serviceRegistrationId}`);
         node.status({
            fill: 'green',
            shape: 'ring',
            text: 'Registered'
         });
      }
      catch (error)
      {
         console.error(`Failed to register service with ViNO API Server - ${error}`, {});
         node.status({
            fill: 'red',
            shape: 'ring',
            text: 'Unregistered'
         });
      }
   }
   async function unregisterService(node)
   {
      const repository = typeorm.getRepository(ServiceRegistration);
      try
      {
         const service = await repository.findOne(node.serviceRegistrationId);
         if (service)
         {
            await repository.remove(service);
            node.log(`Unregistered service with id ${node.serviceRegistrationId}`);
         }
      }
      catch (error)
      {
         console.error(`Failed to unregister service with ViNO API Server - ${error}`, {});
      }
   }
   function ServiceStartNode(nodeDefinition)
   {
      this.name = nodeDefinition.name;
      this.description = nodeDefinition.description;
      this.serviceManagerHost = RED.settings.vino.serviceManagerBaseUrl;
      this.serviceRegistrationId = nodeDefinition.serviceRegistrationId;
      this.activationSteps = [];
      this.deactivationSteps = [];
      RED.nodes.createNode(this, nodeDefinition);
      this.status({
         fill: 'yellow',
         shape: 'ring',
         text: 'Registering...'
      });
      const outer = this;
      this.getTemplate = function()
      {
         return ActivationTemplate.getActivationTemplate(outer, RED);
      };
      this.cancelActivation = function(serviceActivationId)
      {
         const serviceActivation = outer.context().global.vinoServiceActivations[serviceActivationId];
         if (serviceActivation)
         {
            serviceActivation.setStatus('Cancellation Requested', 'Service activation cancel requested', outer);
            serviceActivation.cancel = true;
            return outer.getActivationStatus(serviceActivation.id);
         }
      };
      this.getActivationData = function(serviceActivationId)
      {
         return outer.context().global.vinoServiceActivations[serviceActivationId];
      };
      this.getActivationStatus = function(serviceActivationId, wrapped)
      {
         const serviceActivation = outer.context().global.vinoServiceActivations[serviceActivationId];
         if (serviceActivation)
         {
            const status = serviceActivation.getStatus();
            if (status)
            {
               let ret = status;
               if (wrapped) // TODO: probably don't need this any more
               {
                  ret = { statusList: { statusList: status } };
               }
               return ret;
            }
         }
      };
      this.resolveParametersFromSettings = async function(serviceActivation, defaultSettingsRootPath, steps)
      {
         let defaultPathSplit;
         let rootGroup;
         let defaultRootGroup = null;
         let step;
         serviceActivation.resolvedSettings = {};
         if (defaultSettingsRootPath)
         {
            defaultPathSplit = defaultSettingsRootPath.replace(/^\/+/g, '').split('/');
            try
            {
               defaultRootGroup = await typeorm.getRepository(RootGroup).findOne(
                  { name: defaultPathSplit[0] },
                  { relations: ['defaults', 'defaults.groups', 'groups'] }
               );
               if (defaultRootGroup)
               {
                  defaultRootGroup = await SettingUtilities.expandRootGroup(defaultRootGroup);
                  defaultRootGroup.inheritDefaults();
               }
            }
            catch (err)
            {
               throw new Error(`Error loading root group ${defaultPathSplit[0]} from settings. ${err}`);
            }
         }
         for (let stepIndex = 0; stepIndex < steps.length; stepIndex = stepIndex + 1)
         {
            step = steps[stepIndex];
            if (step.NodeUtility)
            {
               const params = step.NodeUtility.getInputParameters();
               for (const param of params)
               {
                  if (param.isFromConstants())
                  {
                     rootGroup = defaultRootGroup;
                     const subPath = param.inputDetails.constantsPath.split('/');
                     let fullPath;
                     // Handle absolute paths
                     if (param.inputDetails.constantsPath.startsWith('/') && subPath.length >= 1)
                     {
                        try
                        {
                           // eslint-disable-next-line
                           rootGroup = await typeorm.getRepository(RootGroup).findOne(
                              { name: subPath[1] },
                              { relations: ['defaults', 'defaults.groups', 'groups'] }
                           );
                           if (rootGroup)
                           {
                              // eslint-disable-next-line
                              rootGroup = await SettingUtilities.expandRootGroup(rootGroup);
                              rootGroup.inheritDefaults();
                           }
                        }
                        catch (err)
                        {
                           throw new Error(`Error loading root group ${subPath[1]} from settings. ${err}`);
                        }
                        fullPath = subPath;
                     }
                     else if (!defaultSettingsRootPath)
                     {
                        const errMsg = `Parameter "${param.parameterName}" has a relative settings path
                           "${param.inputDetails.constantsPath}", but no default root group was specified with
                           activation input`;
                        throw new Error(errMsg);
                     }
                     else
                     {
                        fullPath = defaultPathSplit.concat(subPath);
                     }
                     fullPath = fullPath.filter(function(element)
                     {
                        return element;
                     });
                     const constant = rootGroup.getConstant(fullPath);
                     if (constant)
                     {
                        serviceActivation.resolvedSettings[param.inputDetails.constantsPath] = constant;
                     }
                     else
                     {
                        throw new Error(`Could not find setting "${param.inputDetails.constantsPath}" in root group "${rootGroup.name}"`);
                     }
                  }
               }
            }
         }
      };
      this.activate = function(activationData)
      {
         // Set up the context for this activation
         const activationId = RED.util.generateId();
         const serviceActivation = new VinoServiceActivation(activationId, outer, activationData);
         const defaultSettingsRoot = activationData.settingsRootGroup;
         const allSteps = outer.activationSteps.concat(outer.deactivationSteps);
         outer.resolveParametersFromSettings(serviceActivation, defaultSettingsRoot, allSteps).then(function()
         {
            // This injects the activation ID into the message being passed to the nodes down the line
            // under the vino parameter.
            const msg =
            {
               vino:
               {
                  serviceActivationId: activationId,
                  rollback: false,
                  debug: serviceActivation.debug
               }
            };
            utils.log('Starting activation of service. Activation ID: ' + activationId, outer, msg);
            outer.send([msg, null]);
         }, function(err)
         {
            serviceActivation.setStatus('Failed', 'Error resolving parameters from settings server. ' + err, outer);
            outer.error(err, {});
         });
         return outer.getActivationStatus(activationId);
      };
      this.getActivatedServiceData = async function(jobId)
      {
         const service = await typeorm.getRepository(ServiceActivation).findOne(jobId, {
            select: [
               'id',
               'referenceId',
               'name',
               'description',
               'customerName',
               'notes',
               'startTime',
               'settingsRootGroup',
               'msg',
               'isUsFederalCustomer'
            ],
            relations: ['status']
         });
         service.steps = await typeorm.getRepository(StepWrapper).find({ where: [{ serviceActivation: service }] });
         return service;
      };
      this.deactivate = async function(activationId, wrapped)
      {
         if (outer.wires[1].length < 1)
         {
            console.error('Requested deactivation for service without deactivation flow');
            throw new Error('No deactivation flow has been defined for this service');
         }
         console.debug(`Received deactivation request for service with ID ${activationId}.`);
         let resp;
         const data = await outer.getActivatedServiceData(activationId);
         const serviceActivation = new VinoServiceActivation(activationId, outer, data, true);
         let msg;
         if (data.msg)
         {
            // Construct the deactivate msg using the saved state of the msg object when service activation completed
            msg = data.msg;
            msg.vino = {
               serviceActivationId: activationId,
               rollback: false,
               deactivate: true,
               debug: serviceActivation.debug
            };
         }
         else
         {
            msg = {
               vino: {
                  serviceActivationId: activationId,
                  rollback: false,
                  deactivate: true,
                  debug: serviceActivation.debug
               }
            };
         }
         resp = [
            {
               status: 'Deactivation Started',
               jobId: activationId,
               time: Date.now()
            }
         ];
         if (wrapped)
         {
            resp = { statusList: { statusList: resp } };
         }
         outer.resolveParametersFromSettings(serviceActivation, data.settingsRootGroup, outer.deactivationSteps).then(
            function()
            {
               outer.send([null, msg]);
            },
            function(err)
            {
               serviceActivation.setStatus('Failed', 'Could not resolve constants from settings server. ' + err, outer);
               serviceActivation.removeServiceActivation();
            }
         );
         return resp;
      };
      this.on('close', async function(done)
      {
         // Unregister this service if this node is deleted from the flow
         await unregisterService(outer);
         done();
      });
      this.gatherServiceSteps = function()
      {
         let copy = Object.assign({}, outer);
         copy.wires = outer.wires.slice();
         copy.wires[1] = [];
         outer.activationSteps = utils.getAllStepsBetweenNodes(copy, null, RED).reverse();
         outer.activationSteps.splice(0, 1);
         outer.activationSteps.forEach(function(node)
         {
            node.isActivationNode = true;
         });
         if (outer.wires[1].length > 0)
         {
            copy = Object.assign({}, outer);
            copy.wires = outer.wires.slice();
            copy.wires[0] = [];
            outer.deactivationSteps = utils.getAllStepsBetweenNodes(copy, null, RED).reverse();
            outer.deactivationSteps.splice(0, 1);
            outer.deactivationSteps.forEach(function(node)
            {
               node.isDeactivationNode = true;
            });
         }
      };
      this.isValid = function()
      {
         const ret =
            {
               result: true,
               errors: []
            };
         if (!outer.activationSteps || outer.activationSteps < 1)
         {
            ret.result = false;
            ret.errors.push('No steps found in activation flow');
         }
         let foundServiceEndPoint = false;
         outer.activationSteps.forEach(function(activationNode)
         {
            if (!activationNode.valid)
            {
               ret.result = false;
               ret.errors.push(`Node ${activationNode.name} is invalid`);
            }
            if (activationNode.type === 'service endpoint')
            {
               foundServiceEndPoint = true;
            }
         });
         if (!foundServiceEndPoint)
         {
            ret.result = false;
            ret.errors.push('No service endpoint was found in the activation flow');
         }
         if (outer.deactivationSteps && outer.deactivationSteps.length > 0)
         {
            let foundDeactivationEndPoint = false;
            outer.deactivationSteps.forEach(function(deactivationNode)
            {
               if (!deactivationNode.valid)
               {
                  ret.result = false;
                  ret.errors.push(`Node ${deactivationNode.name} is invalid`);
               }
               if (deactivationNode.type === 'deactivation endpoint')
               {
                  foundDeactivationEndPoint = true;
               }
            });
            if (!foundDeactivationEndPoint)
            {
               ret.result = false;
               ret.errors.push('No deactivation endpoint was found in the deactivation flow');
            }
         }
         return ret;
      };
   }
   function processNode(node, subflowInstanceNodes)
   {
      switch (node.type)
      {
      case 'loop start':
         node.gatherLoopSteps(subflowInstanceNodes);
         break;
      case 'conditional start':
         node.gatherConditionalSteps();
         break;
      default:
         break;
      }
      const flowsProp = '_flow';
      if (node.type.includes('subflow') && node[flowsProp].activeNodes)
      {
         let instanceNode;
         for (const id in node[flowsProp].activeNodes)
         {
            if (node[flowsProp].activeNodes.hasOwnProperty(id))
            {
               instanceNode = RED.nodes.getNode(id);
               processNode(instanceNode, node[flowsProp].activeNodes);
            }
         }
      }
      node.valid = true;
      node.status({});
   }
   // We need to gather all the steps within a service, loop, and conditiional
   // This event is fired whenever a flow is saved and all the nodes have been created
   RED.events.on('nodes-started', function()
   {
      const services = [];
      const serviceNames = [];
      RED.nodes.eachNode(function(theNode)
      {
         const node = RED.nodes.getNode(theNode.id);
         try
         {
            if (node)
            {
               if (node.type === 'service entrypoint')
               {
                  node.gatherServiceSteps();
                  services.push(node);
               }
               // Make sure any service failure nodes only connect to deactivation flow
               if (node.type === 'service failure' && node.wires[0].length > 0)
               {
                  let outpoutIndex;
                  let deactivateNode;
                  for (outpoutIndex = 0; outpoutIndex < node.wires[0].length; outpoutIndex = outpoutIndex + 1)
                  {
                     deactivateNode = RED.nodes.getNode(node.wires[0][outpoutIndex]);
                     if (deactivateNode && deactivateNode.isActivationNode)
                     {
                        throw new Error('Service failure node may not connect to nodes in activation flow');
                     }
                  }
               }
               processNode(node);
            }
         }
         catch (err)
         {
            node.valid = false;
            node.status({
               fill: 'red',
               shape: 'ring',
               text: `Invalid. ${err}`
            });
         }
      });
      services.forEach(async function(serviceEntryNode)
      {
         const validation = serviceEntryNode.isValid();
         if (validation.result)
         {
            if (serviceNames.indexOf(serviceEntryNode.name) === -1)
            {
               serviceNames.push(serviceEntryNode.name);
               await registerService(serviceEntryNode);
            }
            else
            {
               serviceEntryNode.status({
                  fill: 'red',
                  shape: 'ring',
                  text: `Service with name '${serviceEntryNode.name}' already exists`
               });
            }
         }
         else
         {
            serviceEntryNode.status({
               fill: 'red',
               shape: 'ring',
               text: `Service is invalid. ${validation.errors.join(', ')}`
            });
         }
      });
   });
   RED.nodes.registerType('service entrypoint', ServiceStartNode);
};
