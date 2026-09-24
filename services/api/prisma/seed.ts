import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1) Demo user：demo@shoot-the-ball.local，给旧脚本 / 演示用
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@shoot-the-ball.local' },
    update: {},
    create: {
      email: 'demo@shoot-the-ball.local',
      passwordHash: 'demo123456',
      name: 'Demo User',
      role: 'USER',
    },
  });
  console.log(`Upserted demo user: ${demoUser.id} (${demoUser.email})`);

  const demoProject = await prisma.project.upsert({
    where: { id: 'proj-demo-001' },
    update: {},
    create: {
      id: 'proj-demo-001',
      userId: demoUser.id,
      name: 'Demo Basketball Training',
    },
  });
  console.log(`Upserted demo project: ${demoProject.id}`);

  // 2) Dev user：当 services/api/.env.local 打开 DEV_BYPASS_AUTH=true 时，
  //    所有请求会挂载 currentUser.id = env.DEV_FIXED_USER_ID，这里确保 DB 里有这行数据，
  //    这样 upload-session 查 Project 时不会 user/project 全没数据导致 404。
  //    如果你在 .env.local 改了 DEV_FIXED_USER_ID / EMAIL / NAME，也把下面同步改一下。
  const DEV_FIXED_USER_ID = 'user_dev_000000000000001';
  const DEV_FIXED_USER_EMAIL = 'dev@shoot-the-ball.local';
  const DEV_FIXED_USER_NAME = 'Developer';
  const DEV_PROJECT_ID = 'proj-dev-default-001';

  const devUser = await prisma.user.upsert({
    where: { id: DEV_FIXED_USER_ID },
    update: {
      email: DEV_FIXED_USER_EMAIL,
      name: DEV_FIXED_USER_NAME,
    },
    create: {
      id: DEV_FIXED_USER_ID,
      email: DEV_FIXED_USER_EMAIL,
      passwordHash: '__dev_bypass_no_password__',
      name: DEV_FIXED_USER_NAME,
      role: 'USER',
    },
  });
  console.log(`Upserted dev user: ${devUser.id} (${devUser.email})`);

  const devProject = await prisma.project.upsert({
    where: { id: DEV_PROJECT_ID },
    update: {
      userId: devUser.id,
      name: 'Dev Default Project',
    },
    create: {
      id: DEV_PROJECT_ID,
      userId: devUser.id,
      name: 'Dev Default Project',
    },
  });
  console.log(`Upserted dev project: ${devProject.id}  (upload-session 可直接用这个 ID)`);

  console.log('Seeding complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
