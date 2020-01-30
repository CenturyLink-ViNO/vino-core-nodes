
/* globals jQuery*/
/* globals RED*/
/* globals ctl*/

if (!ctl.ui.getPreviousNodesForNodeId)
{
   ctl.ui.getPreviousNodesForNodeId = function(targetNodeId, startingNodeId, nodes, links)
   {
      const validNodes = {};
      let sourceNode;

      let id;
      let link;
      for (id in links)
      {
         if (links.hasOwnProperty(id))
         {
            link = links[id];

            if (link.target.id === targetNodeId)
            {
               delete links[id];
               sourceNode = nodes[link.source.id];
               if (!sourceNode)
               {
                  return validNodes;
               }
               if (sourceNode.id === startingNodeId)
               {
                  // The starting node is part of a loop, don't include it as a previous step now
                  console.log('Encountered starting node in path traversal, ignoring');
               }
               // Stops us from traversing same path twice or from hitting infinite recursion if flow is cyclic
               else if (!validNodes.hasOwnProperty(sourceNode.id))
               {
                  // Only include our driver nodes
                  if (sourceNode.baseTypes || sourceNode.outputParameters)
                  {
                     validNodes[sourceNode.id] = sourceNode;
                  }
                  else if (sourceNode.type.includes('subflow'))
                  {
                     // For subflows we want to combine all the output parameters within the subflow into a single
                     // node.
                     sourceNode.subFlowOutputParams = ctl.ui.getSubFlowOutputParams(sourceNode);
                     if (sourceNode.subFlowOutputParams.length > 0)
                     {
                        validNodes[sourceNode.id] = sourceNode;
                     }
                  }
                  else if (sourceNode.type === 'link in')
                  {
                     // For now mapping between link nodes is only allowed if they're on the same tab, this is
                     // ensured by the nodes dictionary being filtered to only nodes on the same tab
                     if (sourceNode.links && sourceNode.links.length > 0)
                     {
                        for (const linkIndx in sourceNode.links)
                        {
                           if (sourceNode.links.hasOwnProperty(linkIndx))
                           {
                              const linkNode = sourceNode.links[linkIndx];
                              jQuery.extend(
                                 validNodes,
                                 ctl.ui.getPreviousNodesForNodeId(linkNode, startingNodeId, nodes, links)
                              );
                           }
                        }
                     }
                  }
                  if (sourceNode.inputs > 0)
                  {
                     jQuery.extend(
                        validNodes,
                        ctl.ui.getPreviousNodesForNodeId(link.source.id, startingNodeId, nodes, links)
                     );
                  }
               }
               else
               {
                  // We've already encountered this node and therefore all of it's predecessors
                  console.log('Hit node already processed via another path');
               }
            }
         }
      }
      return validNodes;
   };
}

if (!ctl.ui.getSubFlowOutputParams)
{
   ctl.ui.getSubFlowOutputParams = function(subFlowNode)
   {
      const subflowId = subFlowNode.type.split(':')[1];

      const subflowNodes = ctl.ui.getSubFlowNodes(subflowId, RED.nodes.links);

      let ret = [];
      let id;
      for (id in subflowNodes)
      {
         if (subflowNodes.hasOwnProperty(id))
         {
            const node = subflowNodes[id];

            if (node.type.includes('subflow'))
            {
               ret = ret.concat(ctl.ui.getSubFlowOutputParams(node));
            }
            else
            {
               const outParams = ctl.ui.getOutputParams(node);
               for (const outParamIndex in outParams)
               {
                  if (!(outParams[outParamIndex].outputDetails && outParams[outParamIndex].outputDetails.isPrivate))
                  {
                     if (outParams.hasOwnProperty(outParamIndex))
                     {
                        ret.push({
                           sourceNodeId: node.id,
                           parameterKey: outParams[outParamIndex].parameterKey,
                           parameterName: outParams[outParamIndex].parameterName

                        });
                     }
                  }
               }
            }
         }
      }
      return ret;
   };
}

if (!ctl.ui.getSubFlowNodes)
{
   ctl.ui.getSubFlowNodes = function(subflowId)
   {
      const subflowNodes = {};
      const ret = {};
      let id;
      let link;
      RED.nodes.eachNode(function(node)
      {
         if (node.z === subflowId)
         {
            subflowNodes[node.id] = node;
         }
      });

      for (id in RED.nodes.links)
      {
         if (RED.nodes.links.hasOwnProperty(id))
         {
            link = RED.nodes.links[id];
            if (link.target.type === 'subflow' && link.target.direction === 'out' && link.target.z === subflowId)
            {
               ret[link.source.id] = subflowNodes[link.source.id];
               jQuery.extend(
                  ret,
                  ctl.ui.getPreviousNodesForNodeId(link.source.id, link.source.id, subflowNodes, RED.nodes.links)
               );
            }
         }
      }
      return ret;
   };
}

if (!ctl.ui.getValidParametersAndSteps)
{
   ctl.ui.getValidParametersAndSteps = function(targetNodeId, flowId, isDeactivationNode)
   {
      const nodes = {};
      // Create deep copy of link dictionary so we can modify
      const links = jQuery.extend({}, RED.nodes.links);
      let ret;
      RED.nodes.eachNode(function(node)
      {
         if (node.z === flowId)
         {
            nodes[node.id] = node;
         }
      });
      ctl.ui.onNodesChangeCallback();
      if (targetNodeId !== null)
      {
         ret = ctl.ui.getPreviousNodesForNodeId(targetNodeId, targetNodeId, nodes, links);
      }
      // If this is a deactivation node we include all VINO nodes from the activation flow
      if (isDeactivationNode)
      {
         let nodeIndex;
         for (nodeIndex in nodes)
         {
            if (nodes.hasOwnProperty(nodeIndex))
            {
               if (nodes.hasOwnProperty(nodeIndex) && !nodes[nodeIndex].isDeactivationNode &&
                  (nodes[nodeIndex].baseTypes || nodes[nodeIndex].outputParameters))
               {
                  ret[nodeIndex] = nodes[nodeIndex];
               }
               if (nodes.hasOwnProperty(nodeIndex) && !nodes[nodeIndex].isDeactivationNode &&
                  nodes[nodeIndex].type.includes('subflow'))
               {
                  nodes[nodeIndex].subFlowOutputParams = ctl.ui.getSubFlowOutputParams(nodes[nodeIndex]);
                  if (nodes[nodeIndex].subFlowOutputParams.length > 0)
                  {
                     ret[nodeIndex] = nodes[nodeIndex];
                  }
               }
            }
         }
      }
      // Filter out any nodes within conditionals
      for (const id in ret)
      {
         if (ret.hasOwnProperty(id))
         {
            if (ret[id].isPartOfConditional)
            {
               if (!(nodes[targetNodeId].isPartOfConditional &&
                  ret[id].conditionalStartNode === nodes[targetNodeId].conditionalStartNode))
               {
                  delete ret[id];
               }
            }
         }
      }
      return ret;
   };
}

if (!ctl.ui.populateParameterMappingFields)
{
   ctl.ui.populateParameterMappingFields = function(nodes, mappedNodeSelect, mappedKeySelect)
   {
      mappedNodeSelect.find('option').remove();
      for (const nodeId in nodes)
      {
         if (nodes.hasOwnProperty(nodeId))
         {
            const name = nodes[nodeId].name || nodes[nodeId].type;
            mappedNodeSelect.append('<option value="' + nodeId + '">' +
               name.trim() + '</option>');
         }
      }
      mappedNodeSelect.on('change', function()
      {
         let selection = jQuery(this).val(); //eslint-disable-line
         mappedKeySelect.find('option').remove();
         mappedKeySelect.find('optgroup').remove();
         if (selection)
         {
            const mappedNode = nodes[selection];
            if (mappedNode.subFlowOutputParams)
            {
               // If its from a subflow, include the true source node ID and parameter key in the value
               // We can then later split this to obtain the correct values for parameter mapping
               mappedNode.subFlowOutputParams.forEach(function(param)
               {
                  mappedKeySelect.append('<option value="' +
                     param.sourceNodeId + ':' + param.parameterKey + '">' +
                     param.parameterName.trim() + '</option>');
               });
            }
            else
            {
               const outputParams = ctl.ui.getOutputParams(mappedNode);
               const inputParams = ctl.ui.getInputParams(mappedNode);
               if (outputParams)
               {
                  mappedKeySelect.append('<optgroup label = "Output Parameters">');
                  outputParams.forEach(function(param)
                  {
                     mappedKeySelect.append('<option value="' + param.parameterKey + '">' +
                        param.parameterName.trim() + ' (' + param.parameterType + ')</option>');
                  });
               }
               if (inputParams)
               {
                  mappedKeySelect.append('<optgroup label = "Input Parameters">');
                  inputParams.forEach(function(param)
                  {
                     mappedKeySelect.append('<option value="' + param.parameterKey + '">' +
                        param.parameterName.trim() + ' (' + param.parameterType + ')</option>');
                  });
               }
            }
         }
      });
   };
}
