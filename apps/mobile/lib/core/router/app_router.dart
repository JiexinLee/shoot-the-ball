import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/projects',
    debugLogDiagnostics: true,
    routes: [
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (context, state) =>
            const Placeholder(child: Text('Login Screen')),
      ),
      GoRoute(
        path: '/projects',
        name: 'projects',
        builder: (context, state) =>
            const Placeholder(child: Text('Projects List')),
      ),
      GoRoute(
        path: '/projects/:projectId',
        name: 'project-detail',
        builder: (context, state) => Placeholder(
          child: Text(
            'Project ${state.pathParameters['projectId'] ?? 'unknown'}',
          ),
        ),
      ),
      GoRoute(
        path: '/projects/:projectId/upload',
        name: 'upload',
        builder: (context, state) =>
            const Placeholder(child: Text('Upload Video')),
      ),
      GoRoute(
        path: '/projects/:projectId/processing',
        name: 'processing',
        builder: (context, state) =>
            const Placeholder(child: Text('Processing')),
      ),
      GoRoute(
        path: '/projects/:projectId/highlights',
        name: 'highlights',
        builder: (context, state) =>
            const Placeholder(child: Text('Highlights Review')),
      ),
      GoRoute(
        path: '/projects/:projectId/export',
        name: 'export',
        builder: (context, state) => const Placeholder(child: Text('Export')),
      ),
    ],
  );
});
