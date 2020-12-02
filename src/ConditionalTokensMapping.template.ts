import { BigDecimal, log } from '@graphprotocol/graph-ts'

import { ConditionPreparation, ConditionResolution } from '../generated/ConditionalTokens/ConditionalTokens'
import { Condition, Question, FixedProductMarketMaker, Category, ScalarQuestionLink } from '../generated/schema'
import { assignQuestionToCondition } from './utils/condition';
import { zero } from './utils/constants';
import { requireGlobal } from './utils/global';

export function handleConditionPreparation(event: ConditionPreparation): void {
  let condition = new Condition(event.params.conditionId.toHexString());
  condition.oracle = event.params.oracle;
  condition.questionId = event.params.questionId;

  if (event.params.oracle.toHexString() == '{{RealitioProxy.addressLowerCase}}') {
    log.info('Condition oracle address is RealitioProxy {}', ['{{RealitioProxy.addressLowerCase}}']);
    assignQuestionToCondition(condition, event.params.questionId.toHexString());
  } else if (event.params.oracle.toHexString() == '{{RealitioScalarAdapter.addressLowerCase}}') {
    log.info('Condition oracle address is RealitioScalarAdapter {}', ['{{RealitioScalarAdapter.addressLowerCase}}']);
    let linkId = event.params.questionId.toHexString();
    let link = ScalarQuestionLink.load(linkId);
    if (link != null) {
      assignQuestionToCondition(condition, link.realityEthQuestionId.toHexString());
      condition.scalarLow = link.scalarLow;
      condition.scalarHigh = link.scalarHigh;
    }
  } else {
    log.warning('Condition oracle address {} is not a known Realitio address.', [condition.oracle.toHexString()]);
    assignQuestionToCondition(condition, event.params.questionId.toHexString());
  }

  let global = requireGlobal();
  global.numConditions++;
  global.numOpenConditions++;
  global.save();

  condition.outcomeSlotCount = event.params.outcomeSlotCount.toI32();
  condition.save();
}

export function handleConditionResolution(event: ConditionResolution): void {
  let conditionId = event.params.conditionId.toHexString()
  let condition = Condition.load(conditionId);
  if (condition == null) {
    log.error('could not find condition {} to resolve', [conditionId]);
    return;
  }

  if (condition.question != null) {
    let question = Question.load(condition.question);
    if (question != null) {
      if (question.category != null) {
        let category = Category.load(question.category);
        if (category != null) {
          category.numOpenConditions--;
          category.numClosedConditions++;
          category.save();
        }
      }
    }
  }

  let global = requireGlobal();
  global.numOpenConditions--;
  global.numClosedConditions++;
  global.save();

  if (condition.resolutionTimestamp != null || condition.payouts != null) {
    log.error('should not be able to resolve condition {} more than once', [conditionId]);
    return;
  }

  condition.resolutionTimestamp = event.block.timestamp;

  let payoutNumerators = event.params.payoutNumerators;
  let payoutDenominator = zero;
  for (let i = 0; i < payoutNumerators.length; i++) {
    payoutDenominator = payoutDenominator.plus(payoutNumerators[i]);
  }
  let payoutDenominatorDec = payoutDenominator.toBigDecimal();
  let payouts = new Array<BigDecimal>(payoutNumerators.length);
  for (let i = 0; i < payouts.length; i++) {
    payouts[i] = payoutNumerators[i].divDecimal(payoutDenominatorDec);
  }
  condition.payouts = payouts;

  condition.save();

  let questionId = condition.question
  let question = Question.load(questionId);
  if (question == null) {
    log.info('resolving unlinked condition {}', [conditionId]);
    return;
  }

  let fpmms = question.indexedFixedProductMarketMakers;
  for (let i = 0; i < fpmms.length; i++) {
    let fpmmId = fpmms[i];
    let fpmm = FixedProductMarketMaker.load(fpmmId);
    if (fpmm == null) {
      log.error('indexed fpmm {} not found for question {} for condition {}', [fpmmId, questionId, conditionId]);
      continue;
    }

    fpmm.resolutionTimestamp = event.block.timestamp;
    fpmm.payouts = payouts;

    fpmm.save();
  }
}