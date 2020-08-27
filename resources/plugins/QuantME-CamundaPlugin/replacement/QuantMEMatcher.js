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

import { getRootProcessFromXml, isQuantMETask, getSingleFlowElement } from './Utilities';

export default class QuantMEMatcher {

  /**
   * Check whether the given task matches the detector of the given QRM
   */
  static async matchesQRM(qrm, task) {
    console.log('Matching QRM %s and task with id %s!', qrm.qrmUrl, task.id);

    // check whether the detector is valid and contains exactly one QuantME task
    let rootProcess = await getRootProcessFromXml(qrm.detector);
    let detectorElement = getSingleFlowElement(rootProcess);
    console.log(detectorElement);
    if (detectorElement === undefined || !isQuantMETask(detectorElement)) {
      console.log('Unable to retrieve QuantME task from detector: ', qrm.detector);
      return false;
    }

    // check if QuantME task of the QRM matches the given task
    return this.taskMatchesDetector(detectorElement, task);
  }

  /**
   * Check if the given task matches the detector, i.e., has the same QuantME type and matching attributes
   *
   * For details of the matching concepts see: https://github.com/UST-QuAntiL/QuantME-TransformationFramework/tree/develop/docs/quantme/qrm
   *
   * @param detectorElement the QuantME task from the detector
   * @param task the task to check
   * @return true if the detector matches the task, false otherwise
   */
  static taskMatchesDetector(detectorElement, task) {
    if (detectorElement.$type !== task.$type) {
      console.log('Types of detector and task do not match!');
      return false;
    }

    // check for attributes of the different task types
    switch (task.$type) {
    case 'quantme:QuantumComputationTask':
      return QuantMEMatcher.matchQuantumComputationTask(detectorElement, task);
    case 'quantme:QuantumCircuitLoadingTask':
      return QuantMEMatcher.matchQuantumCircuitLoadingTask(detectorElement, task);
    case 'quantme:DataPreparationTask':
      return QuantMEMatcher.matchDataPreparationTask(detectorElement, task);
    case 'quantme:OracleExpansionTask':
      return QuantMEMatcher.matchOracleExpansionTask(detectorElement, task);
    case 'quantme:QuantumCircuitExecutionTask':
      return QuantMEMatcher.matchQuantumCircuitExecutionTask(detectorElement, task);
    case 'quantme:ReadoutErrorMitigationTask':
      return QuantMEMatcher.matchReadoutErrorMitigationTask(detectorElement, task);
    default:
      console.log('Unsupported QuantME element of type: ', task.$type);
      return false;
    }
  }

  /**
   * Compare the properties of QuantumComputationTasks
   */
  static matchQuantumComputationTask(detectorElement, task) {
    // check if algorithm and provider match
    return this.matchesProperty(detectorElement.algorithm, task.algorithm, true)
      && this.matchesProperty(detectorElement.provider, task.provider, false);
  }

  /**
   * Compare the properties of QuantumCircuitLoadingTasks
   */
  static matchQuantumCircuitLoadingTask(detectorElement, task) {
    // check if either quantumCircuit or url match
    let detectorAlternatives = [detectorElement.quantumCircuit, detectorElement.url];
    let taskAlternatives = [task.quantumCircuit, task.url];
    return this.matchAlternativeProperties(detectorAlternatives, taskAlternatives);
  }

  /**
   * Compare the properties of DataPreparationTasks
   */
  static matchDataPreparationTask(detectorElement, task) {
    // check if encodingSchema and programmingLanguage match
    return this.matchesProperty(detectorElement.encodingSchema, task.encodingSchema, true)
      && this.matchesProperty(detectorElement.programmingLanguage, task.programmingLanguage, true);
  }

  /**
   * Compare the properties of OracleExpansionTasks
   */
  static matchOracleExpansionTask(detectorElement, task) {
    // check if oracleId, programmingLanguage and either oracleCircuit or oracleURL match
    let detectorAlternatives = [detectorElement.oracleCircuit, detectorElement.oracleURL];
    let taskAlternatives = [task.oracleCircuit, task.oracleURL];
    return this.matchesProperty(detectorElement.oracleId, task.oracleId, true)
      && this.matchesProperty(detectorElement.programmingLanguage, task.programmingLanguage, true)
      && this.matchAlternativeProperties(detectorAlternatives, taskAlternatives);
  }

  /**
   * Compare the properties of QuantumCircuitExecutionTasks
   */
  static matchQuantumCircuitExecutionTask(detectorElement, task) {
    // check if provider, qpu, shots, and programmingLanguage match
    return this.matchesProperty(detectorElement.provider, task.provider, false)
      && this.matchesProperty(detectorElement.qpu, task.qpu, false)
      && this.matchesProperty(detectorElement.shots, task.shots, false)
      && this.matchesProperty(detectorElement.programmingLanguage, task.programmingLanguage, true);
  }

  /**
   * Compare the properties of ReadoutErrorMitigationTask
   */
  static matchReadoutErrorMitigationTask(detectorElement, task) {
    // check if unfoldingTechnique, qpu, and maxAge match
    return this.matchesProperty(detectorElement.unfoldingTechnique, task.unfoldingTechnique, true)
      && this.matchesProperty(detectorElement.qpu, task.qpu, true)
      && this.matchesProperty(detectorElement.maxAge, task.maxAge, false);
  }

  /**
   * Check if the attribute value of the detector matches the value of the task
   *
   * @param detectorProperty the value of the detector for a certain attribute
   * @param taskProperty the value of the task for a certain attribute
   * @param required true if the attribute is required, false otherwise
   * @return true if the attribute values of the detector and the task match, false otherwise
   */
  static matchesProperty(detectorProperty, taskProperty, required) {
    // the detector has to define the attribute for a matching
    if (detectorProperty === undefined) {
      return false;
    }

    // if wildcard is defined any value matches
    if (detectorProperty === '*') {
      return true;
    }

    // if an attribute is not defined in the task to replace, any value can be used if the attribute is not required
    if (taskProperty === undefined) {
      return !required;
    }

    // if the detector defines multiple values for the attribute, one has to match the task to replace
    if (detectorProperty.includes(',')) {
      let valueList = detectorProperty.split(',');
      for (let i = 0; i < valueList.length; i++) {
        if (valueList[i].trim() === taskProperty.trim()) {
          return true;
        }
      }
      return false;
    }

    // if the detector contains only one value it has to match exactly
    return detectorProperty.trim() === taskProperty.trim();
  }

  /**
   * Check for a set of alternative properties if exactly one is defined in the task and if it matches the
   * corresponding detector property
   *
   * For details have a look at the 'Alternative Properties' section in the Readme:
   * https://github.com/UST-QuAntiL/QuantME-TransformationFramework/tree/develop/docs/quantme/qrm
   *
   * @param detectorProperties the set of alternative properties of the detector
   * @param taskProperties the set of alternative properties of the task
   * @return true if the task defines exactly one of the alternative properties and it matches the corresponding
   * property of the detector, false otherwise
   */
  static matchAlternativeProperties(detectorProperties, taskProperties) {
    if (detectorProperties.length !== taskProperties.length) {
      console.log('Size of detector properties has to match size of task properties for alternative properties!');
      return false;
    }

    // search the task property that is set
    let taskAlternative = undefined;
    let detectorAlternative = undefined;
    for (let i = 0; i < taskProperties.length; i++) {
      if (taskProperties[i] !== undefined) {

        // only one of the alternative properties must be set for the task
        if (taskAlternative !== undefined) {
          console.log('Multiple alternatives are set in the task properties which is not allowed!');
          return false;
        }
        taskAlternative = taskProperties[i];
        detectorAlternative = detectorProperties[i];
      }
    }

    // check if the found alternative property matches the detector
    return this.matchesProperty(detectorAlternative, taskAlternative, true);
  }
}
