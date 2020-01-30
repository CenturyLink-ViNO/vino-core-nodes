/* globals module*/
/* globals console*/
module.exports = function(RED)
{
   function nextNodeIsLoopStart(node)
   {
      if (node.wires.length > 0 && node.wires[0].length > 0)
      {
         const next = RED.nodes.getNode(node.wires[0][0]);
         return next === node.startNode;
      }
   }

   function LoopEndNode(nodeDefinition)
   {
      RED.nodes.createNode(this, nodeDefinition);
      this.startNode = null; // To be populated by start node at beginning of loop
      const outer = this;

      this.on('input', function(msg)
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

         if (!nextNodeIsLoopStart(outer))
         {
            console.error('loop end node is not connected to loop start', {});
         }

         if (vinoServiceActivation)
         {
            vinoServiceActivation.setStatus(
               'Success',
               `Completed loop '${outer.startNode.name}' iteration ${outer.startNode.currentIteration - 1}`,
               outer
            );
         }

         outer.status({
            fill: 'green',
            shape: 'ring',
            text: 'Completed loop Iteration: ' +
               (outer.startNode.currentIteration - 1)
         });

         outer.send(msg);
      });
   }

   RED.nodes.registerType('loop end', LoopEndNode);
};
