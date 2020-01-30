/* globals jQuery*/
/* globals RED*/
/* globals ctl*/

if (!ctl.ui.getNodesMap)
{
   ctl.ui.getNodesMap = function()
   {
      if (ctl.nodes.dirty)
      {
         ctl.nodes = { dirty: false };
         RED.nodes.eachNode(function(node)
         {
            ctl.nodes[node.id] = node;
         });
      }
      return ctl.nodes;
   };
}

if (!ctl.ui.getNode)
{
   ctl.ui.getNode = function(nodeId)
   {
      const theNodes = ctl.ui.getNodesMap();
      if (theNodes.hasOwnProperty(nodeId))
      {
         return theNodes[nodeId];
      }
   };
}

if (!ctl.ui.nodeChangeListenerRegistered)
{
   ctl.ui.onNodesChangeCallback = function()
   {
      ctl.nodes.dirty = true;
      RED.nodes.links = {};
      RED.nodes.eachLink(function(link)
      {
         link.id = link.source.id + '_' + link.target.id;
         RED.nodes.links[link.id] = link;

         if (link.source.type === 'service entrypoint')
         {
            if (link.sourcePort === 1)
            {
               ctl.ui.doForEachSubsequentNode(link.target, function(node)
               {
                  node.isDeactivationNode = true;
                  return true;
               });
            }
         }
         if (link.source.type === 'conditional start')
         {
            let nestedCount = 0;
            if (link.sourcePort === 0)
            {
               link.source.falseSteps = [];
            }
            else
            {
               link.source.trueSteps = [];
            }
            ctl.ui.doForEachSubsequentNode(link.target, function(node)
            {
               if (node.type === 'conditional start')
               {
                  // Entering a nested conditional
                  // we need to encounter 2 instances of conditional end to know were done
                  nestedCount += 2;
                  if (link.sourcePort === 0)
                  {
                     link.source.falseSteps.push(node);
                  }
                  else
                  {
                     link.source.trueSteps.push(node);
                  }
               }
               else if (node.type === 'conditional end')
               {
                  if (nestedCount <= 1)
                  {
                     node.conditionalStartNode = link.source;
                     return false;
                  }
                  nestedCount -= 1;
                  if (link.sourcePort === 0)
                  {
                     link.source.falseSteps.push(node);
                  }
                  else
                  {
                     link.source.trueSteps.push(node);
                  }
               }
               else
               {
                  node.isPartOfConditional = true;
                  if (nestedCount === 0)
                  {
                     node.condtionalStartNode = link.source;
                     if (link.sourcePort === 0)
                     {
                        link.source.falseSteps.push(node);
                     }
                     else
                     {
                        link.source.trueSteps.push(node);
                     }
                  }
               }
               return true;
            });
         }
      });
   };
   RED.events.on('nodes:change', function(event)
   {
      ctl.ui.onNodesChangeCallback(event);
   });
   ctl.ui.nodeChangeListenerRegistered = true;
}

if (!ctl.ui.doForEachSubsequentNode)
{
   ctl.ui.doForEachSubsequentNode = function(startingNode, functionToApply, theLinks, seenNodes)
   {
      let links = theLinks;
      let seen = seenNodes;
      if (!seen)
      {
         seen = [];
      }
      seen.push(startingNode.id);
      if (!functionToApply(startingNode))
      {
         return;
      }
      if (!links)
      {
         links = {};
         RED.nodes.eachLink(function(link)
         {
            link.id = link.source.id + '_' + link.target.id;
            links[link.id] = link;
         });
      }
      for (const id in links)
      {
         if (links.hasOwnProperty(id) && links[id].source.id === startingNode.id)
         {
            // If we've seen this node before ignore it
            if (seen.indexOf(links[id].target.id) === -1)
            {
               ctl.ui.doForEachSubsequentNode(links[id].target, functionToApply, links, seen);
            }
         }
      }
   };
}

if (!ctl.ui.reorderDisplayIndex)
{
   ctl.ui.reorderDisplayIndex = function(startingIndex, data)
   {
      let dataIndex;
      let param;

      const getFilter = function(filterParam)
      {
         return function(element)
         {
            if (element === filterParam)
            {
               return false;
            }
            if (element.inputDetails && element.inputDetails.displayOrder)
            {
               return element.inputDetails.displayOrder > startingIndex;
            }
            return false;
         };
      };

      for (dataIndex = 0; dataIndex < data.length; dataIndex = dataIndex + 1)
      {
         param = data[dataIndex];
         if (param.inputDetails && param.inputDetails.displayOrder && param.inputDetails.displayOrder === startingIndex)
         {
            param.inputDetails.displayOrder = param.inputDetails.displayOrder + 1;
            const filtered = data.filter(getFilter(param));
            ctl.ui.reorderDisplayIndex(param.inputDetails.displayOrder, filtered);
         }
      }
   };
}

if (!ctl.ui.getProjectFiles)
{
   const deferredString = 'Deferred';
   ctl.ui.getProjectFiles = function()
   {
      const def = jQuery[deferredString](function(deferred)
      {
         const url = '/files';
         const success = function(json)
         {
            if (json === undefined)
            {
               deferred.reject();
            }
            else
            {
               deferred.resolve(json);
            }
         };
         const err = function()
         {
            deferred.reject();
         };
         jQuery.ajax(url, { success: success, error: err });
      });
      return def.promise();
   };
}

if (!ctl.ui.uploadFile)
{
   const deferredString = 'Deferred';
   ctl.ui.uploadFile = function(formData)
   {
      const def = jQuery[deferredString](function(deferred)
      {
         const url = '/files/upload';
         const success = function(json)
         {
            deferred.resolve(json);
         };
         const err = function()
         {
            deferred.reject();
         };
         jQuery.ajax({
            type: 'POST',
            url: url,
            processData: false,
            contentType: false,
            cache: false,
            data: formData,
            success: success,
            error: err
         });
      });
      return def.promise();
   };
}
