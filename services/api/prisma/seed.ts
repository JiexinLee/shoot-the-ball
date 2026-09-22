import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@shoot-the-ball.local' },
    update: {},
    create: {
      email: 'demo@shoot-the-ball.local',
      passwordHash: 'demo123456',
      name: 'Demo User',
      role: UserRole.USER,
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
