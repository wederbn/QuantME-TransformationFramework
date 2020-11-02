/**
 * Copyright (c) 2020 Institute for the Architecture of Application System -
 * University of Stuttgart
 *
 * This program and the accompanying materials are made available under the
 * terms the Apache Software License 2.0
 * which is available at https://www.apache.org/licenses/LICENSE-2.0.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { layout } from './Layouter';
import { matchesQRM } from './QuantMEMatcher';
import { requiredAttributesAvailable } from './QuantMEAttributeChecker';
import {
  getRootProcess,
  getRootProcessFromXml,
  getSingleFlowElement,
  isFlowLikeElement,
  getCamundaInputOutput,
  getPropertiesToCopy
} from '../Utilities';
import { addQuantMEInputParameters } from './InputOutputHandler';

let QRMs = [];

export default class QuantMETransformator {

  constructor(injector, bpmnjs, modeling, elementRegistry, eventBus, bpmnReplace, bpmnFactory) {

    // register the startReplacementProcess() function as editor action to enable the invocation from the menu
    const editorActions = injector.get('editorActions', false);

    // update locally stored QRMs if update is received
    eventBus.on('QRMs.updated', 1000, (event) => {
      console.log('Received event to update QRMs!');
      QRMs = event.data;
    });

    // update current QRMs from repository on action in Camunda editor menu
    editorActions && editorActions.register({
      updateFromQRMRepo: function() {
        updateFromQRMRepo();
      }
    });

    // start replacement on action in Camunda editor menu
    editorActions && editorActions.register({
      startReplacementProcess: async function() {
        await startReplacementProcess();
      }
    });

    /**
     * Initiate the replacement process for the QuantME tasks that are contained in the current process model
     */
    async function startReplacementProcess() {
      console.log('Starting test process for the current process model...');

      // get root element of the current diagram
      const rootElement = getRootProcess(bpmnjs.getDefinitions());
      if (typeof rootElement === 'undefined') {
        console.log('Unable to retrieve root process element from definitions!');
        return;
      }

      // get all QuantME tasks from the process
      const replacementTasks = getQuantMETasks(rootElement);
      console.log('Process contains ' + replacementTasks.length + ' QuantME tasks to replace...');
      if (!replacementTasks || !replacementTasks.length) {
        return;
      }

      // check for available replacement models for all QuantME tasks
      for (let replacementTask of replacementTasks) {

        // abort transformation if at least one task can not be replaced
        replacementTask.qrm = await getMatchingQRM(replacementTask.task);
        if (!replacementTask.qrm) {
          console.log('Unable to replace task with id %s. Aborting transformation!', replacementTask.task.id);

          // inform user via notification in the modeler
          let content = {
            type: 'warning', title: 'Unable to transform workflow',
            content: 'Unable to replace task with id \'' + replacementTask.task.id + '\' by suited QRM', duration: 10000
          };
          eventBus.fire('Notification.display', { data: content });
          return;
        }
      }

      // replace each QuantME tasks to retrieve standard-compliant BPMN
      for (let replacementTask of replacementTasks) {
        console.log('Replacing task with id %s by using QRM: ', replacementTask.task.id, replacementTask.qrm);
        const replacementSuccess = await replaceByFragment(replacementTask.task, replacementTask.parent, replacementTask.qrm.replacement);
        if (!replacementSuccess) {
          console.log('Replacement of QuantME task with Id ' + replacementTask.task.id + ' failed. Aborting process!');
          return;
        }
      }

      // layout diagram after successful transformation
      layout(modeling, elementRegistry, rootElement);
    }

    /**
     * Get QuantME tasks from process
     */
    function getQuantMETasks(process) {

      // retrieve parent object for later replacement
      const processBo = elementRegistry.get(process.id);

      const quantmeTasks = [];
      const flowElements = process.flowElements;
      for (let i = 0; i < flowElements.length; i++) {
        let flowElement = flowElements[i];
        if (flowElement.$type && flowElement.$type.startsWith('quantme:')) {
          quantmeTasks.push({ task: flowElement, parent: processBo });
        }

        // recursively retrieve QuantME tasks if subprocess is found
        if (flowElement.$type && flowElement.$type === 'bpmn:SubProcess') {
          Array.prototype.push.apply(quantmeTasks, getQuantMETasks(flowElement));
        }
      }
      return quantmeTasks;
    }

    /**
     * Search for a matching QRM for the given task
     */
    async function getMatchingQRM(task) {
      for (let i = 0; i < QRMs.length; i++) {
        if (await matchesQRM(QRMs[i], task)) {
          return QRMs[i];
        }
      }
      return undefined;
    }

    /**
     * Replace the given task by the content of the replacement fragment
     */
    async function replaceByFragment(task, parent, replacement) {

      if (!replacement) {
        console.log('Replacement fragment is undefined. Aborting replacement!');
        return false;
      }

      // get the root process of the replacement fragment
      let replacementProcess = await getRootProcessFromXml(replacement);
      let replacementElement = getSingleFlowElement(replacementProcess);
      if (replacementElement === null || replacementElement === undefined) {
        console.log('Unable to retrieve QuantME task from replacement fragment: ', replacement);
        return false;
      }

      console.log('Replacement element: ', replacementElement);
      let result = insertShape(parent, replacementElement, {}, true, task);

      // add all attributes of the replaced QuantME task to the input parameters of the replacement fragment
      let inputOutputExtension = getCamundaInputOutput(result['element'].businessObject, bpmnFactory);
      addQuantMEInputParameters(task, inputOutputExtension, bpmnFactory);

      return result['success'];
    }

    /**
     * Insert the given element and all child elements into the diagram
     *
     * @param parent the parent element under which the new element should be attached
     * @param newElement the new element to insert
     * @param idMap the idMap containing a mapping of ids defined in newElement to the new ids in the diagram
     * @param replace true if the element should be inserted instead of an available element, false otherwise
     * @param oldElement an old element that is only required if it should be replaced by the new element
     * @return {{success: boolean, idMap: *, element: *}}
     */
    function insertShape(parent, newElement, idMap, replace, oldElement) {
      console.log('Inserting shape for element: ', newElement);

      // create new id map if not provided
      if (idMap === undefined) {
        idMap = {};
      }

      let element;
      if (!isFlowLikeElement(newElement.$type)) {
        if (replace) {

          // replace old element to retain attached sequence flow, associations, data objects, ...
          element = bpmnReplace.replaceElement(elementRegistry.get(oldElement.id), { type: newElement.$type });
        } else {

          // create new shape for this element
          element = modeling.createShape({ type: newElement.$type }, { x: 50, y: 50 }, parent, {});
        }
      } else {

        // create connection between two previously created elements
        let sourceElement = elementRegistry.get(idMap[newElement.sourceRef.id]);
        let targetElement = elementRegistry.get(idMap[newElement.targetRef.id]);
        element = modeling.connect(sourceElement, targetElement, { type: newElement.$type });
      }

      // store id to create sequence flows
      idMap[newElement['id']] = element.id;

      // if the element is a subprocess, check if it is expanded in the replacement fragment and expand the new element
      if (newElement.$type === 'bpmn:SubProcess') {

        // get the shape element related to the subprocess
        let shape = newElement.di;
        if (shape && shape.isExpanded) {

          // expand the new element
          elementRegistry.get(element.id).businessObject.di.isExpanded = true;
        }
      }

      // add element to which a boundary event is attached
      if (newElement.$type === 'bpmn:BoundaryEvent') {
        let hostElement = elementRegistry.get(idMap[newElement.attachedToRef.id]);
        modeling.updateProperties(element, { 'attachedToRef': hostElement.businessObject });
        element.host = hostElement;
      }

      // update the properties of the new element
      modeling.updateProperties(element, getPropertiesToCopy(newElement));

      // recursively handle children of the current element
      let resultTuple = insertChildElements(element, newElement, idMap);

      // add artifacts with their shapes to the diagram
      let success = resultTuple['success'];
      idMap = resultTuple['idMap'];
      let artifacts = newElement.artifacts;
      if (artifacts) {
        console.log('Element contains %i artifacts. Adding corresponding shapes...', artifacts.length);
        for (let i = 0; i < artifacts.length; i++) {
          let result = insertShape(element, artifacts[i], idMap, false);
          success = success && result['success'];
          idMap = result['idMap'];
        }
      }

      // return success flag and idMap with id mappings of this element and all children
      return { success: success, idMap: idMap, element: element };
    }

    /**
     * Insert all children of the given element into the diagram
     *
     * @param parent the element that is the new parent of the inserted elements
     * @param newElement the new element to insert the children for
     * @param idMap the idMap containing a mapping of ids defined in newElement to the new ids in the diagram
     * @return {{success: boolean, idMap: *, element: *}}
     */
    function insertChildElements(parent, newElement, idMap) {

      let success = true;
      let flowElements = newElement.flowElements;
      let boundaryEvents = [];
      let sequenceflows = [];
      if (flowElements) {
        console.log('Element contains %i children. Adding corresponding shapes...', flowElements.length);
        for (let i = 0; i < flowElements.length; i++) {

          // skip elements with references and add them after all other elements to set correct references
          if (flowElements[i].$type === 'bpmn:SequenceFlow') {
            sequenceflows.push(flowElements[i]);
            continue;
          }
          if (flowElements[i].$type === 'bpmn:BoundaryEvent') {
            boundaryEvents.push(flowElements[i]);
            continue;
          }

          let result = insertShape(parent, flowElements[i], idMap, false);
          success = success && result['success'];
          idMap = result['idMap'];
        }

        // handle boundary events with new ids of added elements
        for (let i = 0; i < boundaryEvents.length; i++) {
          let result = insertShape(parent, boundaryEvents[i], idMap, false);
          success = success && result['success'];
          idMap = result['idMap'];
        }

        // handle boundary events with new ids of added elements
        for (let i = 0; i < sequenceflows.length; i++) {
          let result = insertShape(parent, sequenceflows[i], idMap, false);
          success = success && result['success'];
          idMap = result['idMap'];
        }
      }

      return { success: success, idMap: idMap, element: parent };
    }

    /**
     * Initiate the replacement process for the QuantME tasks that are contained in the current process model
     */
    function updateFromQRMRepo() {

      // request a update of the currently stored QRMs
      console.log('Updating QRMs from repository!');
      eventBus.fire('QRMs.update', {});
    }
  }
}

QuantMETransformator.$inject = ['injector', 'bpmnjs', 'modeling', 'elementRegistry', 'eventBus', 'bpmnReplace', 'bpmnFactory'];

/**
 * Check whether the given QuantME task can be replaced by an available QRM, which means check if a matching detector can be found
 *
 * @param element the element representing the QuantME task
 * @returns {boolean} true if the task can be replaced, false otherwise
 */
export async function isReplaceable(element) {

  // check for required attributes
  if (!requiredAttributesAvailable(element)) {
    console.log('Missing required attributes. Replacement not possible!');
    return false;
  }

  // search for a suited QRM that can replace the given task
  for (let i = 0; i < QRMs.length; i++) {
    if (await matchesQRM(QRMs[i], element)) {
      return true;
    }
  }

  // no suited QRM found, and therefore, no replacement possible
  return true; // FIXME: QRMs are currently not accessible from this method
}