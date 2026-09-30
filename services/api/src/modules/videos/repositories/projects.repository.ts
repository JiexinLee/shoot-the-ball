import { prisma } from "../../../db/prisma";

export async function findByIdAndUserId(projectId: string, userId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, userId },
  });
}

export const projectsRepository = {
  findByIdAndUserId,
};
