import 'package:flutter_riverpod/flutter_riverpod.dart';

class Project {
  final String id;
  final String userId;
  final String name;
  final String? coverUrl;
  final DateTime createdAt;
  final DateTime updatedAt;

  Project({
    required this.id,
    required this.userId,
    required this.name,
    this.coverUrl,
    required this.createdAt,
    required this.updatedAt,
  });
}

class ProjectsNotifier extends StateNotifier<List<Project>> {
  ProjectsNotifier() : super([]);

  Future<void> fetchProjects() async {
    state = [];
  }

  Future<Project> createProject(String name) async {
    final project = Project(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      userId: 'demo-user',
      name: name,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
    );
    state = [...state, project];
    return project;
  }
}

final projectsProvider =
    StateNotifierProvider<ProjectsNotifier, List<Project>>(
  (ref) => ProjectsNotifier(),
);
