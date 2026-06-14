# 🔧 Advanced Debugging & Performance Optimization Guide

## 1. Deep Memory Profiling

**Analyze what's consuming memory:**

```javascript
// scripts/memory-profiler.js
import v8 from 'v8';
import heapdump from 'heapdump';

class MemoryProfiler {
  constructor() {
    this.checkpoints = [];
  }

  // Get detailed memory info
  getMemoryBreakdown() {
    const heapStats = v8.getHeapStatistics();
    const heapSpaces = v8.getHeapSpaceStatistics();

    return {
      total: {
        heapSize: heapStats.total_heap_size,
        executableSize: heapStats.total_heap_size_executable,
        physicalSize: heapStats.total_physical_size
      },
      spaces: heapSpaces.map(space => ({
        name: space.space_name,
        size: space.space_size,
        used: space.space_used_size,
        limit: space.space_available_size,
        physicalSize: space.physical_size
      }))
    };
  }

  // Track object allocation
  trackAllocations(label) {
    const heap = this.getMemoryBreakdown();
    this.checkpoints.push({
      label,
      timestamp: Date.now(),
      heap,
      gcStats: {
        collections: (global.gc ? 'enabled' : 'disabled')
      }
    });

    console.log(`📸 Checkpoint: ${label}`);
    console.log(`   Total heap: ${Math.round(heap.total.heapSize / 1024 / 1024)}MB`);
    console.log(`   Used: ${heap.spaces.reduce((sum, s) => sum + s.used, 0) / 1024 / 1024}MB`);
  }

  // Generate memory report
  generateReport() {
    const report = {
      checkpoints: this.checkpoints,
      analysis: this.analyzeGrowth(),
      recommendations: this.recommendOptimizations()
    };

    return report;
  }

  // Analyze memory growth between checkpoints
  analyzeGrowth() {
    if (this.checkpoints.length < 2) return null;

    const first = this.checkpoints[0];
    const last = this.checkpoints[this.checkpoints.length - 1];

    const growth = last.heap.total.heapSize - first.heap.total.heapSize;
    const rate = growth / (last.timestamp - first.timestamp);

    return {
      totalGrowth: Math.round(growth / 1024 / 1024) + 'MB',
      growthRate: Math.round(rate) + 'bytes/ms',
      leakLikelihood: rate > 0.1 ? 'HIGH' : rate > 0.01 ? 'MEDIUM' : 'LOW'
    };
  }

  // Recommend optimizations
  recommendOptimizations() {
    const recommendations = [];

    const lastHeap = this.checkpoints[this.checkpoints.length - 1]?.heap;
    if (!lastHeap) return recommendations;

    const largestSpace = lastHeap.spaces.reduce((max, s) => 
      s.used > max.used ? s : max
    );

    if (largestSpace.used > largestSpace.limit * 0.8) {
      recommendations.push(`⚠️ ${largestSpace.name} is ${Math.round(largestSpace.used / largestSpace.limit * 100)}% full`);
    }

    const totalUsed = lastHeap.spaces.reduce((sum, s) => sum + s.used, 0);
    if (totalUsed > 500 * 1024 * 1024) {
      recommendations.push('💡 Consider enabling object pooling');
      recommendations.push('💡 Review message queue sizes');
    }

    return recommendations;
  }
}

export const profiler = new MemoryProfiler();

// Usage
profiler.trackAllocations('startup');

setTimeout(() => {
  profiler.trackAllocations('after-requests');
  const report = profiler.generateReport();
  console.log('\n📊 Memory Report:', JSON.stringify(report, null, 2));
}, 10000);
```

---

## 2. CPU Profiling & Bottleneck Detection

```javascript
// scripts/cpu-profiler.js
import { performance } from 'perf_hooks';

class CPUProfiler {
  constructor() {
    this.measurements = [];
  }

  // Measure function execution time
  measure(label, fn) {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    this.measurements.push({
      label,
      duration,
      timestamp: Date.now()
    });

    if (duration > 100) {
      console.log(`⚠️  SLOW: ${label} took ${duration.toFixed(2)}ms`);
    }

    return result;
  }

  // Identify bottlenecks
  findBottlenecks() {
    const sorted = [...this.measurements].sort((a, b) => b.duration - a.duration);
    const slowest = sorted.slice(0, 5);

    return {
      slowest,
      total: this.measurements.reduce((sum, m) => sum + m.duration, 0),
      average: this.measurements.reduce((sum, m) => sum + m.duration, 0) / this.measurements.length
    };
  }

  // Generate report
  report() {
    const bottlenecks = this.findBottlenecks();
    console.log('\n⏱️ CPU Profile Report:');
    console.log(`Total time: ${bottlenecks.total.toFixed(2)}ms`);
    console.log(`Average per operation: ${bottlenecks.average.toFixed(2)}ms`);
    console.log('\nSlowest operations:');
    bottlenecks.slowest.forEach(m => {
      console.log(`  ${m.label}: ${m.duration.toFixed(2)}ms`);
    });
  }
}

export const cpuProfiler = new CPUProfiler();
```

---

## 3. Database Query Optimization

```javascript
// backend/src/query-analyzer.js
import mongoose from 'mongoose';

class QueryAnalyzer {
  constructor() {
    this.queries = [];
    this.slowQueries = [];
  }

  // Enable query logging
  enableProfiling() {
    mongoose.set('debug', (coll, method, query, doc, options) => {
      const start = Date.now();
      
      const profile = {
        collection: coll,
        method,
        query: JSON.stringify(query),
        timestamp: start
      };

      // Measure completion
      setImmediate(() => {
        const duration = Date.now() - start;
        profile.duration = duration;
        this.queries.push(profile);

        if (duration > 100) {
          this.slowQueries.push(profile);
          console.log(`⚠️  SLOW QUERY (${duration}ms): ${coll}.${method}`);
          console.log(`   Query: ${JSON.stringify(query).substring(0, 200)}`);
        }
      });
    });
  }

  // Get query statistics
  getStats() {
    return {
      totalQueries: this.queries.length,
      slowQueries: this.slowQueries.length,
      averageDuration: this.queries.reduce((sum, q) => sum + q.duration, 0) / this.queries.length,
      slowestQueries: this.slowQueries.sort((a, b) => b.duration - a.duration).slice(0, 10)
    };
  }

  // Recommend indexes
  recommendIndexes() {
    const slowByCollection = {};

    for (const query of this.slowQueries) {
      if (!slowByCollection[query.collection]) {
        slowByCollection[query.collection] = [];
      }
      slowByCollection[query.collection].push(query);
    }

    const recommendations = [];
    for (const [collection, queries] of Object.entries(slowByCollection)) {
      if (queries.length > 5) {
        recommendations.push(`Consider adding indexes to ${collection} collection`);
      }
    }

    return recommendations;
  }
}

export const queryAnalyzer = new QueryAnalyzer();

// Start profiling
queryAnalyzer.enableProfiling();

// Get stats
setTimeout(() => {
  const stats = queryAnalyzer.getStats();
  console.log('📊 Query Stats:', stats);
  console.log('💡 Recommendations:', queryAnalyzer.recommendIndexes());
}, 60000);
```

---

## 4. API Response Time Analysis

```javascript
// backend/src/response-analyzer.js
class ResponseAnalyzer {
  constructor() {
    this.responses = [];
  }

  // Middleware to track response times
  middleware() {
    return (req, res, next) => {
      const start = Date.now();

      // Override res.json
      const originalJson = res.json;
      res.json = function(data) {
        const duration = Date.now() - start;
        
        const analysis = {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
          size: JSON.stringify(data).length,
          timestamp: Date.now()
        };

        this.responses = this.responses || [];
        this.responses.push(analysis);

        if (duration > 500) {
          console.log(`⚠️  SLOW ENDPOINT (${duration}ms): ${req.method} ${req.path}`);
        }

        return originalJson.call(this, data);
      };

      next();
    };
  }

  // Get endpoint statistics
  getEndpointStats() {
    const byEndpoint = {};

    for (const response of this.responses) {
      const key = `${response.method} ${response.path}`;
      if (!byEndpoint[key]) {
        byEndpoint[key] = {
          count: 0,
          totalTime: 0,
          slowestTime: 0,
          errors: 0
        };
      }

      byEndpoint[key].count++;
      byEndpoint[key].totalTime += response.duration;
      byEndpoint[key].slowestTime = Math.max(byEndpoint[key].slowestTime, response.duration);
      if (response.status >= 400) byEndpoint[key].errors++;
    }

    // Calculate averages
    const stats = {};
    for (const [endpoint, data] of Object.entries(byEndpoint)) {
      stats[endpoint] = {
        ...data,
        avgTime: Math.round(data.totalTime / data.count),
        errorRate: (data.errors / data.count * 100).toFixed(2) + '%'
      };
    }

    return stats;
  }

  // Identify slow endpoints
  slowEndpoints() {
    const stats = this.getEndpointStats();
    return Object.entries(stats)
      .filter(([_, data]) => data.avgTime > 200)
      .sort((a, b) => b[1].avgTime - a[1].avgTime)
      .slice(0, 10);
  }
}

export const responseAnalyzer = new ResponseAnalyzer();
```

---

## 5. Event Loop Monitoring

```javascript
// backend/src/event-loop-monitor.js
import { performance, PerformanceObserver } from 'perf_hooks';

class EventLoopMonitor {
  constructor() {
    this.lags = [];
    this.obs = null;
  }

  // Start monitoring
  start() {
    this.obs = new PerformanceObserver((items) => {
      for (const entry of items.getEntries()) {
        if (entry.duration > 10) {
          this.lags.push({
            name: entry.name,
            duration: entry.duration,
            timestamp: Date.now()
          });

          if (entry.duration > 100) {
            console.log(`⚠️  EVENT LOOP LAG (${entry.duration.toFixed(2)}ms): ${entry.name}`);
          }
        }
      }
    });

    this.obs.observe({ entryTypes: ['measure'] });
  }

  // Stop monitoring
  stop() {
    if (this.obs) this.obs.disconnect();
  }

  // Get lag statistics
  getStats() {
    if (this.lags.length === 0) return null;

    const sortedLags = this.lags.sort((a, b) => b.duration - a.duration);
    return {
      totalLags: this.lags.length,
      maxLag: sortedLags[0].duration,
      avgLag: this.lags.reduce((sum, l) => sum + l.duration, 0) / this.lags.length,
      topLags: sortedLags.slice(0, 5)
    };
  }
}

export const eventLoopMonitor = new EventLoopMonitor();
eventLoopMonitor.start();
```

---

## 6. Memory Leak Detection Script

```bash
#!/bin/bash
# scripts/detect-memory-leaks.sh

echo "🔍 Detecting memory leaks..."

# Start app with garbage collection exposed
node --expose-gc backend/src/server.js &
APP_PID=$!

sleep 2

# Function to trigger garbage collection and measure
measure_memory() {
  echo "📊 Memory snapshot..."
  
  # Trigger GC
  kill -USR2 $APP_PID 2>/dev/null || true
  
  sleep 1
  
  # Get memory usage
  ps -p $APP_PID -o pid=,vsz=,rss= | awk '{
    printf "PID: %s, VSZ: %s MB, RSS: %s MB\n", $1, int($2/1024), int($3/1024)
  }'
}

# Monitor for 10 minutes
for i in {1..10}; do
  echo -e "\nIteration $i/10"
  measure_memory
  sleep 60
done

# Clean up
kill $APP_PID

echo -e "\n✅ Memory leak detection complete"
```

---

## 7. Request Tracing

```javascript
// backend/src/request-tracer.js
import { v4 as uuidv4 } from 'uuid';

class RequestTracer {
  constructor() {
    this.traces = new Map();
  }

  // Middleware for tracing
  middleware() {
    return (req, res, next) => {
      const traceId = req.get('X-Trace-ID') || uuidv4();
      const spanId = uuidv4();

      req.traceId = traceId;
      req.spanId = spanId;

      // Add trace context to logs
      const originalLog = console.log;
      console.log = (...args) => {
        originalLog(`[${traceId}]`, ...args);
      };

      // Track request phases
      const phases = {
        start: Date.now(),
        authenticate: null,
        validate: null,
        execute: null,
        serialize: null,
        end: null
      };

      req.tracePhase = (phase) => {
        phases[phase] = Date.now();
      };

      res.on('finish', () => {
        phases.end = Date.now();

        const trace = {
          traceId,
          spanId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration: phases.end - phases.start,
          phases: {
            auth: phases.authenticate - phases.start,
            validation: phases.validate - phases.authenticate,
            execution: phases.execute - phases.validate,
            serialization: phases.serialize - phases.execute,
            total: phases.end - phases.start
          }
        };

        this.traces.set(traceId, trace);

        if (phases.end - phases.start > 1000) {
          console.log('⚠️ SLOW REQUEST');
          console.log(JSON.stringify(trace, null, 2));
        }
      });

      next();
    };
  }

  // Get trace report
  getReport() {
    const traces = Array.from(this.traces.values());
    const slowTraces = traces.filter(t => t.duration > 1000);

    return {
      total: traces.length,
      slow: slowTraces.length,
      avgDuration: traces.reduce((sum, t) => sum + t.duration, 0) / traces.length,
      slowestTraces: slowTraces.sort((a, b) => b.duration - a.duration).slice(0, 10)
    };
  }
}

export const requestTracer = new RequestTracer();
```

---

## 8. Deadlock & Race Condition Detection

```javascript
// scripts/concurrency-test.js
import crypto from 'crypto';

class ConcurrencyTester {
  // Test for race conditions in auth
  async testAuthRaceCondition() {
    console.log('🧪 Testing authentication race condition...');
    
    const promises = [];
    
    // Simulate 100 concurrent login attempts
    for (let i = 0; i < 100; i++) {
      promises.push(
        fetch('http://localhost:5000/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@test.com',
            password: 'TestPass123!'
          })
        })
      );
    }

    const responses = await Promise.all(promises);
    const tokens = responses.map(r => r.json()).map(j => j.data?.token);

    // Check if all tokens are unique
    const unique = new Set(tokens);
    if (unique.size !== tokens.length) {
      console.log('🔴 RACE CONDITION DETECTED: Duplicate tokens issued!');
      return false;
    }

    console.log('✅ No race conditions detected');
    return true;
  }

  // Test for deadlocks in message sending
  async testMessageDeadlock() {
    console.log('🧪 Testing message sending deadlock...');
    
    const conversationId = 'test-conv-123';
    
    // Send 50 messages concurrently
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        fetch(`http://localhost:5000/api/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token'
          },
          body: JSON.stringify({
            text: `Message ${i}`
          }),
          timeout: 5000
        })
      );
    }

    try {
      await Promise.race([
        Promise.all(promises),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout - possible deadlock')), 30000)
        )
      ]);
      
      console.log('✅ No deadlocks detected');
      return true;
    } catch (err) {
      console.log('🔴 DEADLOCK DETECTED:', err.message);
      return false;
    }
  }
}

// Run tests
const tester = new ConcurrencyTester();
await tester.testAuthRaceCondition();
await tester.testMessageDeadlock();
```

---

## 9. Complete Performance Dashboard

```bash
#!/bin/bash
# scripts/performance-dashboard.sh

while true; do
  clear
  
  echo "═══════════════════════════════════════════════════════"
  echo "          PERFORMANCE MONITORING DASHBOARD"
  echo "═══════════════════════════════════════════════════════"
  
  # Node.js Process Stats
  echo -e "\n📊 NODE.JS PROCESS:"
  ps aux | grep "node.*server.js" | grep -v grep | awk '{
    printf "  PID: %s\n  CPU: %s%%\n  Memory: %s MB\n  VSZ: %s MB\n", 
    $2, $3, int($6/1024), int($5/1024)
  }'
  
  # MongoDB Stats
  echo -e "\n🗄️ MONGODB:"
  mongostat --noheaders -n 1 2>/dev/null | head -1 | awk '{
    printf "  Connections: %s\n  Operations: %s/sec\n", $1, $5
  }' || echo "  (MongoDB not available)"
  
  # Network Stats
  echo -e "\n🌐 NETWORK:"
  netstat -an | grep ESTABLISHED | grep 5000 | wc -l | awk '{
    printf "  Active Connections: %s\n", $1
  }'
  
  # Disk Usage
  echo -e "\n💾 DISK:"
  df -h . | tail -1 | awk '{
    printf "  Usage: %s / %s (%s)\n", $3, $2, $5
  }'
  
  # System Load
  echo -e "\n⚙️ SYSTEM:"
  uptime | awk -F'load average:' '{
    printf "  Load Average: %s\n", $2
  }'
  
  echo -e "\n═══════════════════════════════════════════════════════"
  echo "Press Ctrl+C to exit. Refreshing in 5 seconds..."
  
  sleep 5
done
```

---

## 🎯 Complete Debugging Checklist

```
WHEN SOMETHING BREAKS:

1. CHECK LOGS
   [ ] Backend logs (docker logs backend)
   [ ] Frontend console (F12 > Console)
   [ ] Error tracking (Sentry, etc.)

2. MEMORY ANALYSIS
   [ ] Run memory profiler
   [ ] Check for leaks
   [ ] Review heap dumps

3. PERFORMANCE CHECK
   [ ] Run CPU profiler
   [ ] Check slow queries
   [ ] Analyze event loop

4. DATABASE INTEGRITY
   [ ] Run integrity check
   [ ] Verify indexes
   [ ] Check for orphaned records

5. SECURITY SCAN
   [ ] Run malware detector
   [ ] Check for injection
   [ ] Review file integrity

6. CONCURRENCY TEST
   [ ] Test race conditions
   [ ] Check for deadlocks
   [ ] Verify atomicity

7. RESOURCE CHECK
   [ ] Monitor memory (should be < 500MB)
   [ ] Check CPU usage (should be < 50%)
   [ ] Verify connections (should be < 100)

8. NETWORK TEST
   [ ] Check API response times
   [ ] Verify WebSocket connections
   [ ] Test rate limiting

9. REPRODUCTION
   [ ] Create minimal test case
   [ ] Isolate the problem
   [ ] Fix and verify
```

All tools ready! 🛠️
