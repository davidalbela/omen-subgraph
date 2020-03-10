import { log, BigInt, Bytes } from '@graphprotocol/graph-ts'

import {
  LogNewQuestion,
  LogNewAnswer,
  LogNotifyOfArbitrationRequest,
  LogFinalize,
  LogAnswerReveal,
} from '../generated/Realitio/Realitio'
import { Question, FixedProductMarketMaker } from '../generated/schema'

import { unescape } from './unescape'

export function handleNewQuestion(event: LogNewQuestion): void {
  let questionId = event.params.question_id.toHexString();
  let question = new Question(questionId);

  if (event.params.template_id.toI32() != 2) {
    log.info('ignoring question {} with template ID {}', [
      questionId,
      event.params.template_id.toString(),
    ]);
    return;
  }

  let data = event.params.question;
  question.data = data;

  let fields = data.split('\u241f', 4);

  if (fields.length >= 1) {
    question.title = unescape(fields[0]);
    if (fields.length >= 2) {
      let outcomesData = fields[1];
      let start = -1;
      let escaped = false
      let outcomes = new Array<string>(0);
      for (let i = 0; i < outcomesData.length; i++) {
        if (escaped) {
          escaped = false;
        } else {
          if (outcomesData[i] == '"') {
            if (start == -1) {
              start = i + 1;
            } else {
              outcomes.push(unescape(outcomesData.slice(start, i)));
              start = -1;
            }
          } else if (outcomesData[i] == '\\') {
            escaped = true;
          }
        }
      }
      question.outcomes = outcomes;
      if (fields.length >= 3) {
        question.category = unescape(fields[2]);
        if (fields.length >= 4) {
          question.language = unescape(fields[3]);
        }
      }
    }
  }
  question.arbitrator = event.params.arbitrator;
  question.openingTimestamp = event.params.opening_ts;
  question.timeout = event.params.timeout;

  question.isPendingArbitration = false;
  question.arbitrationOccurred = false;

  question.answerFinalizedTimestamp = BigInt.fromI32(0);

  question.indexedFixedProductMarketMakers = [];

  question.save();
}

function saveNewAnswer(questionId: string, answer: Bytes, bond: BigInt, ts: BigInt): void {
  let question = Question.load(questionId);
  if (question == null) {
    log.info('cannot find question {} to answer', [questionId]);
    return;
  }

  let answerFinalizedTimestamp = question.arbitrationOccurred ? ts : ts.plus(question.timeout);

  question.currentAnswer = answer;
  question.currentAnswerBond = bond;
  question.currentAnswerTimestamp = ts;
  question.answerFinalizedTimestamp = answerFinalizedTimestamp;

  question.save();

  let fpmms = question.indexedFixedProductMarketMakers;
  for (let i = 0; i < fpmms.length; i++) {
    let fpmmId = fpmms[i];
    let fpmm = FixedProductMarketMaker.load(fpmmId);
    if (fpmm == null) {
      log.error('indexed fpmm {} not found for question {}', [fpmmId, questionId]);
      continue;
    }

    fpmm.currentAnswer = answer;
    fpmm.currentAnswerBond = bond;
    fpmm.currentAnswerTimestamp = ts;
    fpmm.answerFinalizedTimestamp = answerFinalizedTimestamp;

    fpmm.save();
  }
}

export function handleNewAnswer(event: LogNewAnswer): void {
  if (event.params.is_commitment) {
    // only record confirmed answers
    return;
  }

  let questionId = event.params.question_id.toHexString();
  saveNewAnswer(questionId, event.params.answer, event.params.bond, event.params.ts);
}

export function handleAnswerReveal(event: LogAnswerReveal): void {
  let questionId = event.params.question_id.toHexString();
  saveNewAnswer(questionId, event.params.answer, event.params.bond, event.block.timestamp);
}

export function handleArbitrationRequest(event: LogNotifyOfArbitrationRequest): void {
  let questionId = event.params.question_id.toHexString()
  let question = Question.load(questionId);
  if (question == null) {
    log.info('cannot find question {} to begin arbitration', [questionId]);
    return;
  }

  question.isPendingArbitration = true;

  question.save();
}

export function handleFinalize(event: LogFinalize): void {
  let questionId = event.params.question_id.toHexString()
  let question = Question.load(questionId);
  if (question == null) {
    log.info('cannot find question {} to finalize', [questionId]);
    return;
  }

  question.isPendingArbitration = false;
  question.arbitrationOccurred = true;

  question.save();
}
