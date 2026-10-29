/**
 * 初始化 MongoDB 集合与 JSON Schema 校验器（可选，但推荐执行一次）。
 *
 * Mongoose 在应用层已经定义 schema；本脚本把同样的约束落到数据库层，
 * 让直接写 MongoDB 的脚本/工具也无法插入明显非法的数据。
 *
 * 用法：npm run db:init
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../src/config');

const numberTypes = ['double', 'int', 'long', 'decimal'];
const nullableNumber = [...numberTypes, 'null'];
const dateOrNull = ['date', 'null'];

const validators = {
  users: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['username', 'passwordHash', 'createdAt'],
      properties: {
        schemaVersion: { bsonType: numberTypes },
        username: { bsonType: 'string', minLength: 3, maxLength: 32 },
        passwordHash: { bsonType: 'string', minLength: 20 },
        createdAt: { bsonType: 'date' }
      },
      additionalProperties: true
    }
  },
  surveys: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['ownerId', 'title', 'status', 'shareCode', 'questions',
        'allowAnonymous', 'allowMultiple', 'createdAt', 'updatedAt'],
      properties: {
        schemaVersion: { bsonType: numberTypes },
        ownerId: { bsonType: 'objectId' },
        title: { bsonType: 'string', minLength: 1, maxLength: 120 },
        description: { bsonType: 'string', maxLength: 2000 },
        allowAnonymous: { bsonType: 'bool' },
        allowMultiple: { bsonType: 'bool' },
        status: { enum: ['draft', 'published', 'closed'] },
        shareCode: { bsonType: 'string', minLength: 6, maxLength: 32 },
        deadline: { bsonType: dateOrNull },
        publishedAt: { bsonType: dateOrNull },
        closedAt: { bsonType: dateOrNull },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
        questions: {
          bsonType: 'array',
          maxItems: 100,
          items: {
            bsonType: 'object',
            required: ['qid', 'type', 'title', 'order'],
            properties: {
              qid: { bsonType: 'string', minLength: 1, maxLength: 32 },
              type: { enum: ['single', 'multi', 'text', 'number'] },
              title: { bsonType: 'string', minLength: 1, maxLength: 200 },
              required: { bsonType: 'bool' },
              order: { bsonType: numberTypes },
              options: {
                bsonType: 'array',
                items: {
                  bsonType: 'object',
                  required: ['key', 'label'],
                  properties: {
                    key: { bsonType: 'string', minLength: 1, maxLength: 32 },
                    label: { bsonType: 'string', minLength: 1, maxLength: 200 }
                  },
                  additionalProperties: true
                }
              },
              minSelect: { bsonType: nullableNumber },
              maxSelect: { bsonType: nullableNumber },
              minLength: { bsonType: nullableNumber },
              maxLength: { bsonType: nullableNumber },
              min: { bsonType: nullableNumber },
              max: { bsonType: nullableNumber },
              integerOnly: { bsonType: 'bool' },
              sourceQuestionId: { bsonType: ['objectId', 'null'] },
              sourceVersionId: { bsonType: ['objectId', 'null'] },
              sourceVersion: { bsonType: [...numberTypes, 'null'] },
              jumps: {
                bsonType: 'array',
                maxItems: 50,
                items: {
                  bsonType: 'object',
                  required: ['when'],
                  properties: {
                    when: { bsonType: 'object' },
                    goto: { bsonType: ['string', 'null'] }
                  },
                  additionalProperties: true
                }
              }
            },
            additionalProperties: true
          }
        }
      },
      additionalProperties: true
    }
  },
  responses: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['surveyId', 'answers', 'visitedPath', 'submittedAt'],
      properties: {
        schemaVersion: { bsonType: numberTypes },
        surveyId: { bsonType: 'objectId' },
        respondentId: { bsonType: ['objectId', 'null'] },
        submittedAt: { bsonType: 'date' },
        visitedPath: { bsonType: 'array', items: { bsonType: 'string' } },
        answers: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['qid', 'value'],
            properties: {
              qid: { bsonType: 'string', minLength: 1, maxLength: 32 },
              value: {
                bsonType: ['string', 'int', 'long', 'double', 'decimal', 'bool', 'array']
              },
              questionId: { bsonType: ['objectId', 'null'] },
              questionVersionId: { bsonType: ['objectId', 'null'] }
            },
            additionalProperties: true
          }
        }
      },
      additionalProperties: true
    }
  },
  questionbanks: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['ownerId', 'name', 'isDefault', 'createdAt', 'updatedAt'],
      properties: {
        schemaVersion: { bsonType: numberTypes },
        ownerId: { bsonType: 'objectId' },
        name: { bsonType: 'string', minLength: 1, maxLength: 60 },
        description: { bsonType: 'string', maxLength: 500 },
        isDefault: { bsonType: 'bool' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      },
      additionalProperties: true
    }
  },
  questions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['ownerId', 'bankId', 'title', 'type', 'currentVersion',
        'createdAt', 'updatedAt'],
      properties: {
        schemaVersion: { bsonType: numberTypes },
        ownerId: { bsonType: 'objectId' },
        bankId: { bsonType: 'objectId' },
        title: { bsonType: 'string', minLength: 1, maxLength: 200 },
        type: { enum: ['single', 'multi', 'text', 'number'] },
        currentVersion: { bsonType: numberTypes },
        currentVersionId: { bsonType: ['objectId', 'null'] },
        archivedAt: { bsonType: ['date', 'null'] },
        forkedFromQuestionId: { bsonType: ['objectId', 'null'] },
        forkedFromVersionId: { bsonType: ['objectId', 'null'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      },
      additionalProperties: true
    }
  },
  questionversions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['questionId', 'ownerId', 'version', 'title', 'type', 'createdAt'],
      properties: {
        schemaVersion: { bsonType: numberTypes },
        questionId: { bsonType: 'objectId' },
        ownerId: { bsonType: 'objectId' },
        version: { bsonType: numberTypes },
        title: { bsonType: 'string', minLength: 1, maxLength: 200 },
        type: { enum: ['single', 'multi', 'text', 'number'] },
        options: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            required: ['key', 'label'],
            properties: {
              key: { bsonType: 'string', minLength: 1, maxLength: 32 },
              label: { bsonType: 'string', minLength: 1, maxLength: 200 }
            },
            additionalProperties: true
          }
        },
        minSelect: { bsonType: nullableNumber },
        maxSelect: { bsonType: nullableNumber },
        minLength: { bsonType: nullableNumber },
        maxLength: { bsonType: nullableNumber },
        min: { bsonType: nullableNumber },
        max: { bsonType: nullableNumber },
        integerOnly: { bsonType: 'bool' },
        parentVersionId: { bsonType: ['objectId', 'null'] },
        restoredFromVersionId: { bsonType: ['objectId', 'null'] },
        changeNote: { bsonType: 'string', maxLength: 300 },
        createdBy: { bsonType: 'objectId' },
        createdAt: { bsonType: 'date' }
      },
      additionalProperties: true
    }
  },
  questionshares: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['questionId', 'ownerId', 'sharedWithUserId', 'permission', 'createdAt'],
      properties: {
        schemaVersion: { bsonType: numberTypes },
        questionId: { bsonType: 'objectId' },
        ownerId: { bsonType: 'objectId' },
        sharedWithUserId: { bsonType: 'objectId' },
        permission: { enum: ['use'] },
        createdAt: { bsonType: 'date' }
      },
      additionalProperties: true
    }
  }
};

async function ensureCollection(db, name, validator) {
  const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
  if (!exists) {
    await db.createCollection(name, {
      validator,
      validationLevel: 'moderate',
      validationAction: 'error'
    });
    console.log(`[DB] 创建集合 ${name}（含 JSON Schema 校验）`);
    return;
  }

  try {
    await db.command({
      collMod: name,
      validator,
      validationLevel: 'moderate',
      validationAction: 'error'
    });
    console.log(`[DB] 更新集合 ${name} 的 JSON Schema 校验`);
  } catch (err) {
    console.warn(`[DB] 无法更新 ${name} 校验器（可能权限不足）：${err.message}`);
  }
}

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  console.log('[DB] 已连接', config.mongoUri);

  await ensureCollection(db, 'users', validators.users);
  await ensureCollection(db, 'surveys', validators.surveys);
  await ensureCollection(db, 'responses', validators.responses);
  await ensureCollection(db, 'questionbanks', validators.questionbanks);
  await ensureCollection(db, 'questions', validators.questions);
  await ensureCollection(db, 'questionversions', validators.questionversions);
  await ensureCollection(db, 'questionshares', validators.questionshares);

  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('surveys').createIndex({ shareCode: 1 }, { unique: true });
  await db.collection('surveys').createIndex({ ownerId: 1, createdAt: -1 });
  await db.collection('surveys').createIndex({ status: 1, deadline: 1 });
  await db.collection('surveys').createIndex({ 'questions.sourceQuestionId': 1 });
  await db.collection('surveys').createIndex({ 'questions.sourceVersionId': 1 });
  await db.collection('responses').createIndex({ surveyId: 1, submittedAt: -1 });
  await db.collection('responses').createIndex({ surveyId: 1, respondentId: 1 });
  await db.collection('responses').createIndex({ surveyId: 1, 'answers.qid': 1 });
  await db.collection('responses').createIndex({ 'answers.questionId': 1, submittedAt: -1 });

  await db.collection('questionbanks').createIndex({ ownerId: 1, name: 1 }, { unique: true });
  await db.collection('questionbanks').createIndex(
    { ownerId: 1, isDefault: 1 },
    { unique: true, partialFilterExpression: { isDefault: true } }
  );
  await db.collection('questions').createIndex({ ownerId: 1, bankId: 1, updatedAt: -1 });
  await db.collection('questions').createIndex({ title: 'text' });
  await db.collection('questionversions').createIndex(
    { questionId: 1, version: 1 },
    { unique: true }
  );
  await db.collection('questionshares').createIndex(
    { questionId: 1, sharedWithUserId: 1 },
    { unique: true }
  );
  await db.collection('questionshares').createIndex({ sharedWithUserId: 1, createdAt: -1 });

  console.log('[DB] 索引创建完成');
  console.log('[DB] 初始化完成，可运行 npm run seed 导入演示数据');
}

main()
  .catch((err) => {
    console.error('[DB] 初始化失败：', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
