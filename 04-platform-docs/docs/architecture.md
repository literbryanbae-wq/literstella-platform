# System Architecture

This document outlines the architectural evolution of the LiterStella platform, moving towards a scalable, edge-first infrastructure.

## Current Services
- **Diagnosis**: [read.literstella.co.kr](https://read.literstella.co.kr)
- **Challenge**: [challenge.literstella.co.kr](https://challenge.literstella.co.kr)
- **Coaching**: [coaching.literstella.co.kr](https://coaching.literstella.co.kr)

## Target Tech Stack
- **Frontend**: React (Vite) / Next.js
- **Compute**: Cloudflare Workers (Edge Functions)
- **Database**: Supabase (PostgreSQL + PostgREST)
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage / Cloudflare R2
- **Hosting**: Cloudflare Pages

## High-Level Design

### 1. Edge-First Logic
By utilizing **Cloudflare Workers**, we minimize latency for global users. Authentication and metadata validation happen at the edge before hitting the database.

### 2. Unified Data Layer
All three services (Diagnosis, Challenge, Coaching) will share a unified **Supabase** instance. This allows for:
- Seamless transition from Diagnosis to Challenge.
- Real-time updates for the Challenge dashboard using Supabase Realtime.
- Centralized user profiles and reading history.

### 3. Service Interaction Flow
1. **User** completes **Reading Diagnosis** (Client-side logic + Supabase lead storage).
2. **User** signs up/logs in via **Supabase Auth**.
3. **User** joins a **Challenge** (Supabase Table trigger updates stats).
4. **Master Coach** reviews progress via **Coaching Admin** (Direct DB access with RLS).

## Security & Scalability
- **Row Level Security (RLS)**: Enforced at the Supabase level to ensure users only access their own reading data.
- **Edge Caching**: Static assets and frequently accessed book metadata cached via Cloudflare CDN.
